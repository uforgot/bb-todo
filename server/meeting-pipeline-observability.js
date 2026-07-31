const DEFAULT_LONG_RECORDING_SECONDS = 60 * 60;

function byteLength(value) {
  if (value == null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function bounded(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function classifyPipelineError(error) {
  const value = `${error?.code || ""} ${error?.name || ""} ${error?.message || error || ""}`.toLowerCase();
  if (/abort|timed? out|timeout/.test(value)) return "timeout";
  if (/sqlite_busy|database is locked|sqlite_locked/.test(value)) return "sqlite_busy";
  if (/\b429\b|rate.?limit/.test(value)) return "rate_limited";
  if (/\b5\d\d\b|econnreset|socket|network|fetch failed/.test(value)) return "upstream_unavailable";
  return bounded(error?.code || error?.name || "pipeline_failed", 80) || "pipeline_failed";
}

function sanitizeMetricValue(value) {
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
  return bounded(JSON.stringify(value), 500);
}

function createMeetingPipelineStage({
  meetingId,
  stage,
  logger = console,
  now = () => Date.now(),
  metadata = {},
} = {}) {
  if (!meetingId || !stage) throw new Error("meetingId and stage are required");
  const startedAt = now();
  let finished = false;

  function emit(status, details = {}, error = null) {
    if (finished) return null;
    finished = true;
    const payload = {
      event: "meeting_pipeline_stage",
      meeting_id: meetingId,
      stage,
      status,
      elapsed_ms: Math.max(0, now() - startedAt),
    };
    for (const [key, value] of Object.entries({ ...metadata, ...details })) {
      if (value !== undefined) payload[key] = sanitizeMetricValue(value);
    }
    if (error) {
      payload.error_code = classifyPipelineError(error);
      payload.error = bounded(error?.message || error, 500);
    }
    const line = `[meeting-pipeline] ${JSON.stringify(payload)}`;
    (status === "failed" ? logger.error : logger.log).call(logger, line);
    return payload;
  }

  return {
    complete(details) { return emit("completed", details); },
    fail(error, details) { return emit("failed", details, error); },
  };
}

function elapsedSeconds(from, to) {
  if (!from || !to) return null;
  const value = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function collectMeetingPipelineDiagnostics(db, {
  minDurationSeconds = DEFAULT_LONG_RECORDING_SECONDS,
  limit = 50,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const rows = db.prepare(`
    SELECT id, record_number, duration_seconds, size_bytes,
           transcription_status, transcription_attempts, transcription_error,
           summary_status, summary_error,
           length(transcript) AS transcript_chars,
           length(transcription_words_json) AS words_bytes,
           length(transcription_segments_json) AS segments_bytes,
           recorded_at, transcription_updated_at, summary_updated_at
      FROM meetings
     WHERE duration_seconds>=?
     ORDER BY duration_seconds DESC
     LIMIT ?
  `).all(Math.max(0, Number(minDurationSeconds) || 0), Math.min(Math.max(Number(limit) || 50, 1), 500));

  const attemptsForRecord = db.prepare(`
    SELECT j.id AS job_id, j.generation, j.status AS job_status,
           a.attempt, a.status, a.error_code, a.error,
           a.created_at, a.dispatched_at, a.acknowledged_at, a.finished_at
      FROM meeting_summary_jobs j
      LEFT JOIN meeting_summary_attempts a ON a.job_id=j.id
     WHERE j.record_id=?
     ORDER BY j.generation, a.attempt
  `);

  const records = rows.map(row => {
    const attempts = attemptsForRecord.all(row.id).map(attempt => ({
      job_id: attempt.job_id,
      generation: attempt.generation,
      attempt: attempt.attempt,
      status: attempt.status || attempt.job_status,
      error_code: attempt.error_code || null,
      error: attempt.error || null,
      dispatch_seconds: elapsedSeconds(attempt.created_at, attempt.dispatched_at),
      acknowledgement_seconds: elapsedSeconds(attempt.dispatched_at, attempt.acknowledged_at || attempt.finished_at),
      processing_seconds: elapsedSeconds(attempt.acknowledged_at, attempt.finished_at),
    }));
    const failureCodes = [...new Set(attempts.map(item => item.error_code).filter(Boolean))];
    let diagnosis = "completed";
    if (row.transcription_status === "failed") diagnosis = "transcription_failed";
    else if (row.summary_status === "failed") diagnosis = "summary_failed";
    else if (failureCodes.includes("agent_ack_timeout")) diagnosis = "summary_agent_ack_timeout_recovered";
    else if (failureCodes.length) diagnosis = "summary_retry_recovered";

    return {
      id: row.id,
      record_number: row.record_number,
      duration_seconds: row.duration_seconds,
      audio_bytes: row.size_bytes,
      transcript_chars: row.transcript_chars || 0,
      words_bytes: row.words_bytes || 0,
      segments_bytes: row.segments_bytes || 0,
      transcription: {
        status: row.transcription_status,
        attempts: row.transcription_attempts || 0,
        error: row.transcription_error || null,
      },
      summary: {
        status: row.summary_status,
        error: row.summary_error || null,
        attempts,
        failure_codes: failureCodes,
      },
      diagnosis,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    min_duration_seconds: minDurationSeconds,
    query_elapsed_ms: Math.max(0, now() - startedAt),
    record_count: records.length,
    records,
  };
}

module.exports = {
  DEFAULT_LONG_RECORDING_SECONDS,
  byteLength,
  classifyPipelineError,
  collectMeetingPipelineDiagnostics,
  createMeetingPipelineStage,
};
