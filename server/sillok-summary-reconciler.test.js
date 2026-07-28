const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const {
  migrateMeetingSummaryJobsSchema,
  createMeetingSummaryJobService,
} = require("./meeting-summary-jobs");
const {
  calculateBackoffMs,
  createSillokSummaryReconciler,
} = require("./sillok-summary-reconciler");

function createFixture({ maxAttempts = 5, backoffScheduleMs = [30_000, 120_000, 600_000, 1_800_000], dispatcher } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY, record_number INTEGER, transcription_status TEXT,
      transcript TEXT, transcription_words_json TEXT, transcription_segments_json TEXT,
      speaker_names_json TEXT, title TEXT, title_source TEXT, summary TEXT,
      summary_status TEXT, summary_model TEXT, summary_error TEXT,
      summary_updated_at TEXT, updated_at TEXT
    );
  `);
  db.prepare(`
    INSERT INTO meetings VALUES (
      'record-1', 41, 'completed', 'speaker_0: 복구 테스트 회의 원문',
      '[{"speaker_id":"speaker_0"}]', '[{"speaker_id":"speaker_0"}]', '{}',
      '기존 제목', 'user', '기존에 게시된 요약', 'completed', 'old/model', NULL, NULL, ?
    )
  `).run("2026-07-28T04:00:00.000Z");
  migrateMeetingSummaryJobsSchema(db);
  let current = new Date("2026-07-28T04:00:00.000Z");
  let id = 0;
  let nonce = 0;
  const makeService = () => createMeetingSummaryJobService({
    db,
    now: () => current,
    createId: () => `id-${++id}`,
    createNonce: () => `nonce-${++nonce}-valid`,
    processingLeaseMs: 60_000,
  });
  const service = makeService();
  const reconciler = createSillokSummaryReconciler({
    summaryJobs: service,
    dispatcher,
    now: () => current,
    intervalMs: 0,
    dispatchTimeoutMs: 20_000,
    acknowledgementTimeoutMs: 120_000,
    maxAttempts,
    backoffScheduleMs,
    jitterRatio: 0,
    random: () => 0.5,
    logger: { log() {}, error() {} },
  });
  const advance = ms => { current = new Date(current.getTime() + ms); };
  const createJob = () => service.createJob("record-1");
  const dispatch = jobId => {
    const started = service.startAttempt(jobId);
    const attempt = started.job.current_attempt;
    service.markDispatched(jobId, {
      attemptId: attempt.id,
      nonce: attempt.nonce,
      channelId: "1475129999991509094",
      messageId: `message-${attempt.attempt}`,
    });
    return attempt;
  };
  const claim = (jobId, attempt) => service.claimJob(jobId, {
    attemptId: attempt.id,
    nonce: attempt.nonce,
    agent: "bbangbbang",
    schemaVersion: 1,
  });
  return { db, service, makeService, reconciler, advance, createJob, dispatch, claim };
}

test("calculates bounded deterministic exponential backoff", () => {
  const options = { scheduleMs: [30_000, 120_000, 600_000, 1_800_000], jitterRatio: 0, random: () => 0.5 };
  assert.equal(calculateBackoffMs(1, options), 30_000);
  assert.equal(calculateBackoffMs(2, options), 120_000);
  assert.equal(calculateBackoffMs(3, options), 600_000);
  assert.equal(calculateBackoffMs(99, options), 1_800_000);
});

test("recovers an offline listener after acknowledgement timeout", async () => {
  const f = createFixture();
  const job = f.createJob();
  f.dispatch(job.id);
  f.advance(120_001);

  const timedOut = await f.reconciler.runOnce();
  assert.equal(timedOut.transitions[0].action, "retry_scheduled");
  assert.equal(f.service.getJob(job.id).status, "retry_wait");
  assert.equal(f.service.getJob(job.id).last_error_code, "agent_ack_timeout");
  assert.equal(f.db.prepare("SELECT summary FROM meetings WHERE id='record-1'").get().summary, "기존에 게시된 요약");

  f.advance(30_000);
  const due = await f.reconciler.runOnce();
  assert.equal(due.transitions[0].action, "requeued");
  assert.equal(f.service.getJob(job.id).status, "queued");
  f.db.close();
});

test("reclaims a stale processing lease without publishing partial output", async () => {
  const f = createFixture();
  const job = f.createJob();
  const attempt = f.dispatch(job.id);
  f.claim(job.id, attempt);
  f.advance(60_001);

  await f.reconciler.runOnce();
  assert.equal(f.service.getJob(job.id).status, "retry_wait");
  assert.equal(f.service.getJob(job.id).last_error_code, "processing_lease_expired");
  assert.deepEqual(
    f.db.prepare("SELECT summary, summary_status FROM meetings WHERE id='record-1'").get(),
    { summary: "기존에 게시된 요약", summary_status: "queued" },
  );
  f.db.close();
});

test("dead-letters repeated Discord send failures at the attempt cap", async () => {
  const f = createFixture({ maxAttempts: 2, backoffScheduleMs: [1_000, 1_000] });
  const job = f.createJob();
  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    const started = f.service.startAttempt(job.id).job.current_attempt;
    f.service.requeueDispatchFailure(job.id, {
      attemptId: started.id,
      nonce: started.nonce,
      errorCode: "discord_send_failed",
      error: "forced Discord failure",
      nextAttemptAt: new Date(Date.parse("2026-07-28T04:00:00.000Z") + attemptNumber * 1_000).toISOString(),
    });
    if (attemptNumber === 1) f.advance(1_000);
  }

  const result = await f.reconciler.runOnce();
  assert.equal(result.transitions[0].action, "dead_lettered");
  assert.equal(f.service.getJob(job.id).status, "failed");
  assert.equal(f.service.getJob(job.id).last_error_code, "attempt_budget_exhausted");
  assert.equal(f.db.prepare("SELECT summary FROM meetings WHERE id='record-1'").get().summary, "기존에 게시된 요약");
  f.db.close();
});

test("server restart recovery becomes dispatchable again", async () => {
  const f = createFixture({ backoffScheduleMs: [0] });
  const job = f.createJob();
  const attempt = f.dispatch(job.id);
  f.claim(job.id, attempt);

  const restarted = f.makeService();
  assert.equal(restarted.recoverInterruptedJobs(), 1);
  const reconciler = createSillokSummaryReconciler({
    summaryJobs: restarted,
    now: () => new Date("2026-07-28T04:00:00.000Z"),
    intervalMs: 0,
    backoffScheduleMs: [0],
    jitterRatio: 0,
    logger: { log() {}, error() {} },
  });
  await reconciler.runOnce();
  assert.equal(restarted.getJob(job.id).status, "queued");
  f.db.close();
});

test("rejects a late old success and stores the retried result exactly once", async () => {
  const f = createFixture({ backoffScheduleMs: [0] });
  const job = f.createJob();
  const oldAttempt = f.dispatch(job.id);
  f.claim(job.id, oldAttempt);
  f.advance(60_001);
  await f.reconciler.runOnce();
  await f.reconciler.runOnce();

  const newAttempt = f.dispatch(job.id);
  f.claim(job.id, newAttempt);
  const payload = {
    schemaVersion: 1,
    title: "복구된 제목",
    summary: "첫 번째 문장이다. 두 번째 문장이다. 세 번째 문장이다.",
    model: "openai/gpt-5.6-sol",
    agent: "bbangbbang",
    contextMode: "openclaw_memory",
  };
  assert.throws(
    () => f.service.completeJob(job.id, { ...payload, attemptId: oldAttempt.id, nonce: oldAttempt.nonce }),
    error => error.code === "stale_attempt",
  );
  f.service.completeJob(job.id, { ...payload, attemptId: newAttempt.id, nonce: newAttempt.nonce });
  const replay = f.service.completeJob(job.id, { ...payload, attemptId: newAttempt.id, nonce: newAttempt.nonce });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM meeting_summary_jobs WHERE status='completed'").get().count, 1);
  f.db.close();
});

test("Discord reconnect reconciles first and wakes the dispatcher", async () => {
  let reconnects = 0;
  const dispatcher = { async onReconnect() { reconnects += 1; return [{ dispatched: true }]; } };
  const f = createFixture({ dispatcher });
  const result = await f.reconciler.onDiscordReconnect();
  assert.equal(reconnects, 1);
  assert.equal(result.dispatched[0].dispatched, true);
  f.db.close();
});
