const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const {
  migrateMeetingSummaryJobsSchema,
  createMeetingSummaryJobService,
} = require("./meeting-summary-jobs");

function createFixture({ title = "기존 제목", titleSource = "default" } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      record_number INTEGER,
      transcription_status TEXT,
      transcript TEXT,
      title TEXT,
      title_source TEXT,
      summary TEXT,
      summary_status TEXT,
      summary_model TEXT,
      summary_error TEXT,
      summary_updated_at TEXT,
      updated_at TEXT
    );
  `);
  db.prepare(`
    INSERT INTO meetings (
      id, record_number, transcription_status, transcript, title, title_source,
      summary, summary_status, summary_model, updated_at
    ) VALUES ('record-1', 16, 'completed', '회의 원문', ?, ?, '기존 요약', 'completed', 'old/model', ?)
  `).run(title, titleSource, "2026-07-28T00:00:00.000Z");
  migrateMeetingSummaryJobsSchema(db);

  let current = new Date("2026-07-28T04:00:00.000Z");
  let id = 0;
  let nonce = 0;
  const completions = [];
  const makeService = () => createMeetingSummaryJobService({
    db,
    now: () => current,
    createId: () => `id-${++id}`,
    createNonce: () => `nonce-${++nonce}`,
    processingLeaseMs: 60_000,
    onCompleted: event => completions.push(event),
  });

  return {
    db,
    service: makeService(),
    makeService,
    completions,
    advance(ms) { current = new Date(current.getTime() + ms); },
  };
}

function beginProcessing(service, jobId) {
  const started = service.startAttempt(jobId).job;
  const attempt = started.current_attempt;
  service.markDispatched(jobId, {
    attemptId: attempt.id,
    nonce: attempt.nonce,
    channelId: "1475129999991509094",
    messageId: "message-1",
  });
  service.claimJob(jobId, {
    attemptId: attempt.id,
    nonce: attempt.nonce,
    agent: "bbangbbang",
    schemaVersion: 1,
  });
  return attempt;
}

function resultPayload(attempt, overrides = {}) {
  return {
    attemptId: attempt.id,
    nonce: attempt.nonce,
    schemaVersion: 1,
    title: "맥락을 반영한 제목",
    summary: "형주의 프로젝트 맥락을 반영한 자연스러운 요약이다.",
    model: "openai/gpt-5.6-sol",
    agent: "bbangbbang",
    contextMode: "openclaw_memory",
    ...overrides,
  };
}

test("migrates durable tables and deduplicates transcription completion", () => {
  const { db, service } = createFixture();
  const first = service.createJob("record-1");
  const duplicate = service.createJob("record-1");

  assert.equal(first.id, duplicate.id);
  assert.equal(first.generation, 1);
  assert.equal(first.status, "queued");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM meeting_summary_jobs").get().count, 1);
  assert.deepEqual(
    db.prepare("SELECT summary, summary_status, summary_model FROM meetings WHERE id='record-1'").get(),
    { summary: "기존 요약", summary_status: "queued", summary_model: "openclaw-agent" },
  );
  db.close();
});

test("completes exactly once, preserves a user title, and accepts identical replay", () => {
  const { db, service, completions } = createFixture({ title: "형주가 쓴 제목", titleSource: "user" });
  const job = service.createJob("record-1");
  const attempt = beginProcessing(service, job.id);

  const completed = service.completeJob(job.id, resultPayload(attempt));
  const replay = service.completeJob(job.id, resultPayload(attempt));

  assert.equal(completed.status, "completed");
  assert.equal(completed.idempotent_replay, false);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(completions.length, 1);
  assert.deepEqual(
    db.prepare("SELECT title, title_source, summary, summary_status, summary_model FROM meetings WHERE id='record-1'").get(),
    {
      title: "형주가 쓴 제목",
      title_source: "user",
      summary: "형주의 프로젝트 맥락을 반영한 자연스러운 요약이다.",
      summary_status: "completed",
      summary_model: "openai/gpt-5.6-sol",
    },
  );
  assert.throws(
    () => service.completeJob(job.id, resultPayload(attempt, { summary: "충돌하는 결과" })),
    error => error.code === "result_conflict" && error.statusCode === 409,
  );
  db.close();
});

test("rejects a late stale response after failure and retry", () => {
  const { db, service, completions } = createFixture();
  const job = service.createJob("record-1");
  const firstAttempt = beginProcessing(service, job.id);
  service.failAttempt(job.id, {
    attemptId: firstAttempt.id,
    nonce: firstAttempt.nonce,
    errorCode: "discord_timeout",
    error: "callback timed out",
    retryable: true,
  });
  service.retryJob(job.id);
  const secondAttempt = beginProcessing(service, job.id);

  assert.throws(
    () => service.completeJob(job.id, resultPayload(firstAttempt)),
    error => error.code === "stale_attempt" && error.statusCode === 409,
  );
  service.completeJob(job.id, resultPayload(secondAttempt));

  assert.equal(completions.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM meeting_summary_attempts").get().count, 2);
  assert.equal(db.prepare("SELECT summary_status FROM meetings WHERE id='record-1'").get().summary_status, "completed");
  db.close();
});

test("recovers an interrupted processing lease after service restart", () => {
  const { db, service, makeService } = createFixture();
  const job = service.createJob("record-1");
  const firstAttempt = beginProcessing(service, job.id);

  const restarted = makeService();
  assert.equal(restarted.recoverInterruptedJobs(), 1);
  assert.equal(restarted.getJob(job.id).status, "retry_wait");
  assert.deepEqual(
    db.prepare("SELECT status, error_code FROM meeting_summary_attempts WHERE id=?").get(firstAttempt.id),
    { status: "failed", error_code: "server_restart" },
  );
  assert.equal(db.prepare("SELECT summary_status FROM meetings WHERE id='record-1'").get().summary_status, "queued");

  restarted.retryJob(job.id);
  const second = restarted.startAttempt(job.id).job.current_attempt;
  assert.notEqual(second.nonce, firstAttempt.nonce);
  assert.equal(second.attempt, 2);
  db.close();
});

test("regeneration creates a new generation without blanking the published summary", () => {
  const { db, service } = createFixture();
  const first = service.createJob("record-1");
  const attempt = beginProcessing(service, first.id);
  service.completeJob(first.id, resultPayload(attempt));

  const second = service.createJob("record-1", { trigger: "manual_regenerate", regenerate: true });

  assert.equal(second.generation, 2);
  assert.equal(second.status, "queued");
  assert.deepEqual(
    db.prepare("SELECT summary, summary_status FROM meetings WHERE id='record-1'").get(),
    {
      summary: "형주의 프로젝트 맥락을 반영한 자연스러운 요약이다.",
      summary_status: "queued",
    },
  );
  db.close();
});

test("validates transcript readiness and processing lease", () => {
  const { db, service, advance } = createFixture();
  db.prepare("UPDATE meetings SET transcription_status='failed' WHERE id='record-1'").run();
  assert.throws(
    () => service.createJob("record-1"),
    error => error.code === "transcript_required" && error.statusCode === 409,
  );

  db.prepare("UPDATE meetings SET transcription_status='completed' WHERE id='record-1'").run();
  const job = service.createJob("record-1");
  const attempt = beginProcessing(service, job.id);
  advance(61_000);
  assert.throws(
    () => service.completeJob(job.id, resultPayload(attempt)),
    error => error.code === "lease_expired" && error.statusCode === 409,
  );
  db.close();
});
