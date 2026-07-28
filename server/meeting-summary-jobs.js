const crypto = require("crypto");

const JOB_STATUSES = [
  "queued",
  "dispatching",
  "awaiting_agent",
  "processing",
  "retry_wait",
  "completed",
  "failed",
  "cancelled",
];
const ACTIVE_ATTEMPT_STATUSES = ["dispatching", "awaiting_agent", "processing"];

function serviceError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function migrateMeetingSummaryJobsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meeting_summary_jobs (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'queued','dispatching','awaiting_agent','processing',
        'retry_wait','completed','failed','cancelled'
      )),
      trigger TEXT NOT NULL,
      context_mode TEXT NOT NULL DEFAULT 'openclaw_memory',
      result_title TEXT,
      result_summary TEXT,
      result_model TEXT,
      result_agent TEXT,
      result_hash TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      current_attempt_id TEXT,
      next_attempt_at TEXT,
      last_error_code TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(record_id, generation)
    );

    CREATE TABLE IF NOT EXISTS meeting_summary_attempts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES meeting_summary_jobs(id),
      attempt INTEGER NOT NULL,
      nonce TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN (
        'dispatching','awaiting_agent','processing','completed','failed','cancelled'
      )),
      discord_channel_id TEXT,
      discord_message_id TEXT,
      dispatched_at TEXT,
      acknowledged_at TEXT,
      lease_expires_at TEXT,
      finished_at TEXT,
      error_code TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(job_id, attempt)
    );

    CREATE INDEX IF NOT EXISTS idx_meeting_summary_jobs_record_generation
      ON meeting_summary_jobs(record_id, generation DESC);
    CREATE INDEX IF NOT EXISTS idx_meeting_summary_jobs_pending
      ON meeting_summary_jobs(status, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_meeting_summary_attempts_job
      ON meeting_summary_attempts(job_id, attempt DESC);
  `);
}

function createMeetingSummaryJobService({
  db,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
  createNonce = () => crypto.randomBytes(24).toString("hex"),
  processingLeaseMs = 15 * 60 * 1000,
  onCompleted = () => {},
} = {}) {
  if (!db) throw new Error("db is required");

  const isoNow = () => now().toISOString();
  const bounded = (value, max) => String(value || "").trim().slice(0, max);
  const getJobRow = id => db.prepare("SELECT * FROM meeting_summary_jobs WHERE id=?").get(id);
  const getAttemptRow = id => db.prepare("SELECT * FROM meeting_summary_attempts WHERE id=?").get(id);

  function serializeJob(row, { includeNonce = false } = {}) {
    if (!row) return null;
    const attempt = row.current_attempt_id ? getAttemptRow(row.current_attempt_id) : null;
    return {
      id: row.id,
      record_id: row.record_id,
      generation: row.generation,
      status: row.status,
      trigger: row.trigger,
      context_mode: row.context_mode,
      attempt_count: row.attempt_count,
      next_attempt_at: row.next_attempt_at,
      last_error_code: row.last_error_code,
      last_error: row.last_error,
      result: row.status === "completed" ? {
        title: row.result_title,
        summary: row.result_summary,
        model: row.result_model,
        agent: row.result_agent,
        hash: row.result_hash,
      } : null,
      current_attempt: attempt ? {
        id: attempt.id,
        attempt: attempt.attempt,
        status: attempt.status,
        ...(includeNonce ? { nonce: attempt.nonce } : {}),
        discord_channel_id: attempt.discord_channel_id,
        discord_message_id: attempt.discord_message_id,
        dispatched_at: attempt.dispatched_at,
        acknowledged_at: attempt.acknowledged_at,
        lease_expires_at: attempt.lease_expires_at,
        error_code: attempt.error_code,
        error: attempt.error,
      } : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    };
  }

  function requireMeeting(recordId) {
    const meeting = db.prepare("SELECT * FROM meetings WHERE id=?").get(recordId);
    if (!meeting) throw serviceError(404, "meeting_not_found", "meeting not found");
    if (meeting.transcription_status !== "completed" || !String(meeting.transcript || "").trim()) {
      throw serviceError(409, "transcript_required", "completed meeting transcript is required");
    }
    return meeting;
  }

  function createJob(recordId, { trigger = "transcription_completed", regenerate = false } = {}) {
    requireMeeting(recordId);
    const timestamp = isoNow();
    const create = db.transaction(() => {
      const latest = db.prepare(`
        SELECT * FROM meeting_summary_jobs
         WHERE record_id=?
         ORDER BY generation DESC
         LIMIT 1
      `).get(recordId);
      if (latest && !regenerate) return latest;
      if (latest && !["completed", "failed", "cancelled"].includes(latest.status)) {
        return latest;
      }

      const generation = (latest?.generation || 0) + 1;
      const id = createId();
      db.prepare(`
        INSERT INTO meeting_summary_jobs (
          id, record_id, generation, status, trigger, context_mode,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', ?, 'openclaw_memory', ?, ?)
      `).run(id, recordId, generation, bounded(trigger, 80) || "manual", timestamp, timestamp);
      db.prepare(`
        UPDATE meetings
           SET summary_status='queued',
               summary_model='openclaw-agent',
               summary_error=NULL,
               summary_updated_at=?,
               updated_at=?
         WHERE id=?
      `).run(timestamp, timestamp, recordId);
      return getJobRow(id);
    });
    return serializeJob(create());
  }

  function getJob(jobId, options) {
    const row = getJobRow(jobId);
    if (!row) throw serviceError(404, "job_not_found", "summary job not found");
    return serializeJob(row, options);
  }

  function listJobs({ status = "pending", limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    let rows;
    if (status === "pending") {
      const timestamp = isoNow();
      rows = db.prepare(`
        SELECT * FROM meeting_summary_jobs
         WHERE status IN ('queued', 'retry_wait')
           AND (next_attempt_at IS NULL OR next_attempt_at<=?)
         ORDER BY created_at ASC, generation ASC
         LIMIT ?
      `).all(timestamp, safeLimit);
    } else if (JOB_STATUSES.includes(status)) {
      rows = db.prepare(`
        SELECT * FROM meeting_summary_jobs
         WHERE status=?
         ORDER BY updated_at DESC
         LIMIT ?
      `).all(status, safeLimit);
    } else if (status === "all") {
      rows = db.prepare("SELECT * FROM meeting_summary_jobs ORDER BY updated_at DESC LIMIT ?").all(safeLimit);
    } else {
      throw serviceError(400, "invalid_status", "invalid summary job status");
    }
    return rows.map(row => serializeJob(row));
  }

  function startAttempt(jobId) {
    const timestamp = isoNow();
    const result = db.transaction(() => {
      const job = getJobRow(jobId);
      if (!job) throw serviceError(404, "job_not_found", "summary job not found");
      if (!['queued', 'retry_wait'].includes(job.status)) {
        if (ACTIVE_ATTEMPT_STATUSES.includes(job.status) && job.current_attempt_id) {
          return { job: getJobRow(jobId), attempt: getAttemptRow(job.current_attempt_id), replay: true };
        }
        throw serviceError(409, "job_not_dispatchable", "summary job is not dispatchable");
      }
      if (job.next_attempt_at && job.next_attempt_at > timestamp) {
        throw serviceError(409, "retry_not_due", "summary job retry is not due");
      }
      const attempt = Number(job.attempt_count || 0) + 1;
      const attemptId = createId();
      const nonce = createNonce();
      db.prepare(`
        INSERT INTO meeting_summary_attempts (
          id, job_id, attempt, nonce, status, created_at
        ) VALUES (?, ?, ?, ?, 'dispatching', ?)
      `).run(attemptId, jobId, attempt, nonce, timestamp);
      db.prepare(`
        UPDATE meeting_summary_jobs
           SET status='dispatching', attempt_count=?, current_attempt_id=?,
               next_attempt_at=NULL, last_error_code=NULL, last_error=NULL, updated_at=?
         WHERE id=?
      `).run(attempt, attemptId, timestamp, jobId);
      return { job: getJobRow(jobId), attempt: getAttemptRow(attemptId), replay: false };
    })();
    const meeting = db.prepare("SELECT record_number FROM meetings WHERE id=?").get(result.job.record_id);
    return {
      job: serializeJob(result.job, { includeNonce: true }),
      record_number: meeting?.record_number ?? null,
      replay: result.replay,
    };
  }

  function markDispatched(jobId, { attemptId, nonce, channelId, messageId } = {}) {
    const timestamp = isoNow();
    const row = db.transaction(() => {
      const job = getJobRow(jobId);
      const attempt = attemptId ? getAttemptRow(attemptId) : null;
      if (!job || !attempt || attempt.job_id !== jobId || job.current_attempt_id !== attemptId || attempt.nonce !== nonce) {
        throw serviceError(409, "stale_attempt", "summary attempt is stale");
      }
      if (job.status === "awaiting_agent" && attempt.status === "awaiting_agent") return getJobRow(jobId);
      if (job.status !== "dispatching" || attempt.status !== "dispatching") {
        throw serviceError(409, "invalid_attempt_state", "summary attempt is not dispatching");
      }
      db.prepare(`
        UPDATE meeting_summary_attempts
           SET status='awaiting_agent', discord_channel_id=?, discord_message_id=?, dispatched_at=?
         WHERE id=?
      `).run(bounded(channelId, 40) || null, bounded(messageId, 40) || null, timestamp, attemptId);
      db.prepare("UPDATE meeting_summary_jobs SET status='awaiting_agent', updated_at=? WHERE id=?")
        .run(timestamp, jobId);
      return getJobRow(jobId);
    })();
    return serializeJob(row);
  }

  function claimJob(jobId, { attemptId, nonce, agent, schemaVersion = 1 } = {}) {
    if (Number(schemaVersion) !== 1) throw serviceError(400, "unsupported_schema", "unsupported schema version");
    const timestamp = isoNow();
    const leaseExpiresAt = new Date(now().getTime() + processingLeaseMs).toISOString();
    const result = db.transaction(() => {
      const job = getJobRow(jobId);
      const attempt = attemptId ? getAttemptRow(attemptId) : null;
      if (!job) throw serviceError(404, "job_not_found", "summary job not found");
      if (!attempt || attempt.job_id !== jobId || job.current_attempt_id !== attemptId || attempt.nonce !== nonce) {
        throw serviceError(409, "stale_attempt", "summary attempt is stale");
      }
      if (job.status === "processing" && attempt.status === "processing") {
        return { job, attempt, replay: true };
      }
      if (job.status !== "awaiting_agent" || attempt.status !== "awaiting_agent") {
        throw serviceError(409, "invalid_attempt_state", "summary attempt is not awaiting an agent");
      }
      db.prepare(`
        UPDATE meeting_summary_attempts
           SET status='processing', acknowledged_at=?, lease_expires_at=?
         WHERE id=?
      `).run(timestamp, leaseExpiresAt, attemptId);
      db.prepare("UPDATE meeting_summary_jobs SET status='processing', result_agent=?, updated_at=? WHERE id=?")
        .run(bounded(agent, 80) || "bbangbbang", timestamp, jobId);
      db.prepare(`
        UPDATE meetings
           SET summary_status='processing', summary_model='openclaw-agent',
               summary_error=NULL, summary_updated_at=?, updated_at=?
         WHERE id=?
      `).run(timestamp, timestamp, job.record_id);
      return { job: getJobRow(jobId), attempt: getAttemptRow(attemptId), replay: false };
    })();
    const meeting = db.prepare("SELECT id, record_number FROM meetings WHERE id=?").get(result.job.record_id);
    return {
      job_id: jobId,
      record_id: result.job.record_id,
      record_number: meeting?.record_number ?? null,
      generation: result.job.generation,
      transcript_url: `/api/meetings/${result.job.record_id}`,
      lease_expires_at: result.attempt.lease_expires_at,
      context_mode: result.job.context_mode,
      replay: result.replay,
    };
  }

  function canonicalResult({ title, summary, speakerNames, model, agent, contextMode }) {
    const normalizedSpeakerNames = {};
    if (speakerNames != null) {
      if (typeof speakerNames !== "object" || Array.isArray(speakerNames)) {
        throw serviceError(400, "invalid_speaker_names", "speaker_names must be an object");
      }
      for (const speakerId of Object.keys(speakerNames).sort()) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(speakerId) || speakerNames[speakerId] !== "신빵") {
          throw serviceError(400, "invalid_speaker_names", "speaker_names may only map transcript speaker IDs to 신빵");
        }
        normalizedSpeakerNames[speakerId] = "신빵";
      }
    }
    const result = {
      title: bounded(title, 80),
      summary: bounded(summary, 4000),
      speaker_names: normalizedSpeakerNames,
      model: bounded(model, 120),
      agent: bounded(agent, 80),
      context_mode: bounded(contextMode || "openclaw_memory", 80),
    };
    if (!result.title) throw serviceError(400, "title_required", "summary title is required");
    if (!result.summary) throw serviceError(400, "summary_required", "summary is required");
    if (!result.model) throw serviceError(400, "model_required", "summary model is required");
    if (!result.agent) throw serviceError(400, "agent_required", "summary agent is required");
    result.hash = crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex");
    return result;
  }

  function completeJob(jobId, { attemptId, nonce, schemaVersion = 1, title, summary, speakerNames, model, agent, contextMode } = {}) {
    if (Number(schemaVersion) !== 1) throw serviceError(400, "unsupported_schema", "unsupported schema version");
    const result = canonicalResult({ title, summary, speakerNames, model, agent, contextMode });
    const timestamp = isoNow();
    const completed = db.transaction(() => {
      const job = getJobRow(jobId);
      const attempt = attemptId ? getAttemptRow(attemptId) : null;
      if (!job) throw serviceError(404, "job_not_found", "summary job not found");
      if (!attempt || attempt.job_id !== jobId || job.current_attempt_id !== attemptId || attempt.nonce !== nonce) {
        throw serviceError(409, "stale_attempt", "summary attempt is stale");
      }
      if (job.status === "completed") {
        if (attempt.status === "completed" && job.result_hash === result.hash) {
          return { row: job, replay: true };
        }
        throw serviceError(409, "result_conflict", "completed summary result does not match");
      }
      if (job.status !== "processing" || attempt.status !== "processing") {
        throw serviceError(409, "invalid_attempt_state", "summary attempt is not processing");
      }
      if (attempt.lease_expires_at && attempt.lease_expires_at < timestamp) {
        throw serviceError(409, "lease_expired", "summary attempt lease expired");
      }
      const meeting = db.prepare("SELECT * FROM meetings WHERE id=?").get(job.record_id);
      if (!meeting) throw serviceError(404, "meeting_not_found", "meeting not found");
      const transcriptSpeakerIds = new Set();
      for (const raw of [meeting.transcription_segments_json, meeting.transcription_words_json]) {
        let entries = [];
        try { entries = JSON.parse(raw || "[]"); } catch {}
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (typeof entry?.speaker_id === "string") transcriptSpeakerIds.add(entry.speaker_id);
        }
      }
      for (const speakerId of Object.keys(result.speaker_names)) {
        if (!transcriptSpeakerIds.has(speakerId)) {
          throw serviceError(400, "unknown_speaker_id", "speaker_names contains an ID not present in the transcript");
        }
      }
      let existingSpeakerNames = {};
      try { existingSpeakerNames = JSON.parse(meeting.speaker_names_json || "{}"); } catch {}
      if (!existingSpeakerNames || typeof existingSpeakerNames !== "object" || Array.isArray(existingSpeakerNames)) {
        existingSpeakerNames = {};
      }
      const mergedSpeakerNames = { ...result.speaker_names, ...existingSpeakerNames };
      const preserveUserTitle = meeting.title_source === "user";
      db.prepare(`
        UPDATE meeting_summary_jobs
           SET status='completed', result_title=?, result_summary=?, result_model=?,
               result_agent=?, context_mode=?, result_hash=?, last_error_code=NULL,
               last_error=NULL, completed_at=?, updated_at=?
         WHERE id=?
      `).run(
        result.title, result.summary, result.model, result.agent,
        result.context_mode, result.hash, timestamp, timestamp, jobId,
      );
      db.prepare(`
        UPDATE meeting_summary_attempts
           SET status='completed', finished_at=?, error_code=NULL, error=NULL
         WHERE id=?
      `).run(timestamp, attemptId);
      db.prepare(`
        UPDATE meetings
           SET title=?, title_source=?, summary=?, speaker_names_json=?, summary_status='completed',
               summary_model=?, summary_error=NULL, summary_updated_at=?, updated_at=?
         WHERE id=?
      `).run(
        preserveUserTitle ? meeting.title : result.title,
        preserveUserTitle ? "user" : "ai",
        result.summary,
        JSON.stringify(mergedSpeakerNames),
        result.model,
        timestamp,
        timestamp,
        job.record_id,
      );
      return { row: getJobRow(jobId), replay: false };
    })();
    if (!completed.replay) onCompleted({ jobId, recordId: completed.row.record_id, generation: completed.row.generation });
    return { ...serializeJob(completed.row), idempotent_replay: completed.replay };
  }

  function failAttempt(jobId, { attemptId, nonce, errorCode = "attempt_failed", error = "summary attempt failed", retryable = true, nextAttemptAt = null } = {}) {
    const timestamp = isoNow();
    const row = db.transaction(() => {
      const job = getJobRow(jobId);
      const attempt = attemptId ? getAttemptRow(attemptId) : null;
      if (!job || !attempt || attempt.job_id !== jobId || job.current_attempt_id !== attemptId || attempt.nonce !== nonce) {
        throw serviceError(409, "stale_attempt", "summary attempt is stale");
      }
      if (!ACTIVE_ATTEMPT_STATUSES.includes(job.status) || !ACTIVE_ATTEMPT_STATUSES.includes(attempt.status)) {
        throw serviceError(409, "invalid_attempt_state", "summary attempt is not active");
      }
      const jobStatus = retryable ? "retry_wait" : "failed";
      const publicStatus = retryable ? "queued" : "failed";
      db.prepare(`
        UPDATE meeting_summary_attempts
           SET status='failed', finished_at=?, error_code=?, error=?
         WHERE id=?
      `).run(timestamp, bounded(errorCode, 80), bounded(error, 1000), attemptId);
      db.prepare(`
        UPDATE meeting_summary_jobs
           SET status=?, next_attempt_at=?, last_error_code=?, last_error=?, updated_at=?
         WHERE id=?
      `).run(jobStatus, nextAttemptAt, bounded(errorCode, 80), bounded(error, 1000), timestamp, jobId);
      db.prepare(`
        UPDATE meetings
           SET summary_status=?, summary_error=?, summary_updated_at=?, updated_at=?
         WHERE id=?
      `).run(publicStatus, retryable ? null : bounded(error, 1000), timestamp, timestamp, job.record_id);
      return getJobRow(jobId);
    })();
    return serializeJob(row);
  }

  function requeueDispatchFailure(jobId, {
    attemptId,
    nonce,
    errorCode = "discord_send_failed",
    error = "Discord summary dispatch failed",
    nextAttemptAt = null,
  } = {}) {
    const timestamp = isoNow();
    const row = db.transaction(() => {
      const job = getJobRow(jobId);
      const attempt = attemptId ? getAttemptRow(attemptId) : null;
      if (!job || !attempt || attempt.job_id !== jobId || job.current_attempt_id !== attemptId || attempt.nonce !== nonce) {
        throw serviceError(409, "stale_attempt", "summary attempt is stale");
      }
      if (job.status !== "dispatching" || attempt.status !== "dispatching") {
        throw serviceError(409, "invalid_attempt_state", "summary attempt is not dispatching");
      }
      const boundedCode = bounded(errorCode, 80) || "discord_send_failed";
      const boundedError = bounded(error, 1000) || "Discord summary dispatch failed";
      db.prepare(`
        UPDATE meeting_summary_attempts
           SET status='failed', finished_at=?, error_code=?, error=?
         WHERE id=?
      `).run(timestamp, boundedCode, boundedError, attemptId);
      db.prepare(`
        UPDATE meeting_summary_jobs
           SET status='queued', current_attempt_id=NULL, next_attempt_at=?,
               last_error_code=?, last_error=?, updated_at=?
         WHERE id=?
      `).run(nextAttemptAt, boundedCode, boundedError, timestamp, jobId);
      db.prepare(`
        UPDATE meetings
           SET summary_status='queued', summary_error=NULL,
               summary_updated_at=?, updated_at=?
         WHERE id=?
      `).run(timestamp, timestamp, job.record_id);
      return getJobRow(jobId);
    })();
    return serializeJob(row);
  }

  function deadLetterJob(jobId, {
    errorCode = "attempt_budget_exhausted",
    error = "summary attempt budget exhausted",
    expectedStatuses = ["queued", "retry_wait"],
  } = {}) {
    const timestamp = isoNow();
    const row = db.transaction(() => {
      const job = getJobRow(jobId);
      if (!job) throw serviceError(404, "job_not_found", "summary job not found");
      if (!expectedStatuses.includes(job.status)) {
        throw serviceError(409, "invalid_job_state", "summary job cannot be dead-lettered from its current state");
      }
      const boundedCode = bounded(errorCode, 80) || "attempt_budget_exhausted";
      const boundedError = bounded(error, 1000) || "summary attempt budget exhausted";
      db.prepare(`
        UPDATE meeting_summary_jobs
           SET status='failed', next_attempt_at=NULL, last_error_code=?,
               last_error=?, updated_at=?
         WHERE id=?
      `).run(boundedCode, boundedError, timestamp, jobId);
      db.prepare(`
        UPDATE meetings
           SET summary_status='failed', summary_error=?,
               summary_updated_at=?, updated_at=?
         WHERE id=?
      `).run(boundedError, timestamp, timestamp, job.record_id);
      return getJobRow(jobId);
    })();
    return serializeJob(row);
  }

  function retryJob(jobId) {
    const timestamp = isoNow();
    const row = db.transaction(() => {
      const job = getJobRow(jobId);
      if (!job) throw serviceError(404, "job_not_found", "summary job not found");
      if (!['retry_wait', 'failed'].includes(job.status)) {
        throw serviceError(409, "job_not_retryable", "summary job is not retryable");
      }
      db.prepare(`
        UPDATE meeting_summary_jobs
           SET status='queued', current_attempt_id=NULL, next_attempt_at=NULL,
               last_error_code=NULL, last_error=NULL, updated_at=?
         WHERE id=?
      `).run(timestamp, jobId);
      db.prepare(`
        UPDATE meetings
           SET summary_status='queued', summary_model='openclaw-agent',
               summary_error=NULL, summary_updated_at=?, updated_at=?
         WHERE id=?
      `).run(timestamp, timestamp, job.record_id);
      return getJobRow(jobId);
    })();
    return serializeJob(row);
  }

  function recoverInterruptedJobs() {
    const timestamp = isoNow();
    return db.transaction(() => {
      const interrupted = db.prepare(`
        SELECT * FROM meeting_summary_jobs
         WHERE status IN ('dispatching','awaiting_agent','processing')
      `).all();
      const failAttemptStatement = db.prepare(`
        UPDATE meeting_summary_attempts
           SET status='failed', finished_at=?, error_code='server_restart',
               error='server restarted before summary attempt completed'
         WHERE id=? AND status IN ('dispatching','awaiting_agent','processing')
      `);
      const recoverJob = db.prepare(`
        UPDATE meeting_summary_jobs
           SET status='retry_wait', next_attempt_at=?, last_error_code='server_restart',
               last_error='server restarted before summary attempt completed', updated_at=?
         WHERE id=?
      `);
      const recoverMeeting = db.prepare(`
        UPDATE meetings
           SET summary_status='queued', summary_error=NULL,
               summary_updated_at=?, updated_at=?
         WHERE id=?
      `);
      for (const job of interrupted) {
        // A dispatching attempt may have reached Discord before the process stopped.
        // Keep the same attempt so the dispatcher can replay Discord's stable nonce.
        if (job.status === "dispatching") continue;
        if (job.current_attempt_id) failAttemptStatement.run(timestamp, job.current_attempt_id);
        recoverJob.run(timestamp, timestamp, job.id);
        recoverMeeting.run(timestamp, timestamp, job.record_id);
      }
      return interrupted.length;
    })();
  }

  return {
    createJob,
    getJob,
    listJobs,
    startAttempt,
    markDispatched,
    claimJob,
    completeJob,
    failAttempt,
    requeueDispatchFailure,
    deadLetterJob,
    retryJob,
    recoverInterruptedJobs,
  };
}

module.exports = {
  JOB_STATUSES,
  migrateMeetingSummaryJobsSchema,
  createMeetingSummaryJobService,
};
