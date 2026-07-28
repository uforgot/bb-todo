const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const {
  migrateMeetingSummaryJobsSchema,
  createMeetingSummaryJobService,
} = require("./meeting-summary-jobs");
const {
  PAYLOAD_SCHEMA,
  buildDiscordMessageNonce,
  createSillokSummaryDispatcher,
} = require("./sillok-summary-dispatcher");

function createFixture({ sendMessage, sendTimeoutMs = 100, retryDelayMs = 1_000 } = {}) {
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
    ) VALUES (?, ?, 'completed', ?, '비공개 제목', 'user', ?, 'completed', 'old/model', ?)
  `).run(
    "record-private-1",
    21,
    "절대 Discord에 포함되면 안 되는 회의 원문과 위치: 서울 서대문구",
    "기존 요약도 Discord에 포함되면 안 된다",
    "2026-07-28T04:00:00.000Z",
  );
  migrateMeetingSummaryJobsSchema(db);

  let current = new Date("2026-07-28T04:00:00.000Z");
  let id = 0;
  let nonce = 0;
  const summaryJobs = createMeetingSummaryJobService({
    db,
    now: () => current,
    createId: () => `id-${++id}`,
    createNonce: () => `attempt-nonce-${++nonce}`,
  });
  const sends = [];
  const dispatcher = createSillokSummaryDispatcher({
    summaryJobs,
    channelId: "1475129999991509094",
    targetUserId: "1471495923400970377",
    pollIntervalMs: 0,
    sendTimeoutMs,
    retryDelayMs,
    now: () => current,
    logger: { log() {}, error() {} },
    sendMessage: async payload => {
      sends.push(payload);
      if (sendMessage) return sendMessage(payload, sends.length);
      return { id: `discord-message-${sends.length}` };
    },
  });

  return {
    db,
    summaryJobs,
    dispatcher,
    sends,
    advance(ms) { current = new Date(current.getTime() + ms); },
    createJob() { return summaryJobs.createJob("record-private-1"); },
  };
}

test("dispatches a bounded locator with an explicit mention and records acknowledgement", async () => {
  const fixture = createFixture();
  const job = fixture.createJob();

  const result = await fixture.dispatcher.dispatchJob(job.id);
  assert.equal(result.dispatched, true);
  assert.equal(fixture.sends.length, 1);

  const sent = fixture.sends[0];
  assert.equal(sent.channelId, "1475129999991509094");
  assert.deepEqual(sent.allowedUserIds, ["1471495923400970377"]);
  assert.equal(sent.enforceNonce, true);
  assert.equal(sent.nonce, buildDiscordMessageNonce(job.id, 1));
  assert.match(sent.content, /^<@1471495923400970377>\n\[SILLOK_SUMMARY_JOB_V1\]/);
  assert.match(sent.content, /record_id: record-private-1/);
  assert.match(sent.content, /record_number: 21/);
  assert.match(sent.content, new RegExp(`job_id: ${job.id}`));
  assert.match(sent.content, /attempt_id: id-2/);
  assert.match(sent.content, /nonce: attempt-nonce-1/);
  assert.match(sent.content, new RegExp(`callback: /api/meeting-summary-jobs/${job.id}/result`));
  assert.doesNotMatch(sent.content, /회의 원문|서울|서대문구|기존 요약|비공개 제목|transcript|location|memory/i);

  const stored = fixture.summaryJobs.getJob(job.id);
  assert.equal(stored.status, "awaiting_agent");
  assert.equal(stored.current_attempt.discord_channel_id, "1475129999991509094");
  assert.equal(stored.current_attempt.discord_message_id, "discord-message-1");

  const duplicate = await fixture.dispatcher.dispatchJob(job.id);
  assert.equal(duplicate.reason, "already_dispatched");
  assert.equal(fixture.sends.length, 1);
  fixture.db.close();
});

test("keeps permission failures queued with durable backoff and a failed attempt", async () => {
  const fixture = createFixture({
    sendMessage: async () => {
      throw Object.assign(new Error("Discord POST 403: Missing Permissions"), { statusCode: 403 });
    },
  });
  const job = fixture.createJob();

  const result = await fixture.dispatcher.dispatchJob(job.id);
  assert.deepEqual(
    { dispatched: result.dispatched, queued: result.queued, error_code: result.error_code },
    { dispatched: false, queued: true, error_code: "discord_permission_denied" },
  );
  const stored = fixture.summaryJobs.getJob(job.id);
  assert.equal(stored.status, "queued");
  assert.equal(stored.last_error_code, "discord_permission_denied");
  assert.ok(stored.next_attempt_at);
  assert.equal(fixture.summaryJobs.listJobs({ status: "pending" }).length, 0);
  assert.deepEqual(
    fixture.db.prepare("SELECT status, error_code FROM meeting_summary_attempts WHERE job_id=?").get(job.id),
    { status: "failed", error_code: "discord_permission_denied" },
  );
  fixture.db.close();
});

test("times out a stalled Discord send and leaves the job queued", async () => {
  const fixture = createFixture({
    sendTimeoutMs: 10,
    sendMessage: () => new Promise(() => {}),
  });
  const job = fixture.createJob();

  const result = await fixture.dispatcher.dispatchJob(job.id);
  assert.equal(result.dispatched, false);
  assert.equal(result.queued, true);
  assert.equal(result.error_code, "discord_timeout");
  assert.equal(fixture.summaryJobs.getJob(job.id).status, "queued");
  fixture.db.close();
});

test("reconnect replays an interrupted dispatch with the same attempt and Discord nonce", async () => {
  const fixture = createFixture();
  const job = fixture.createJob();
  const interrupted = fixture.summaryJobs.startAttempt(job.id);
  const originalAttempt = interrupted.job.current_attempt;
  const originalDiscordNonce = buildDiscordMessageNonce(job.id, job.generation);

  assert.equal(fixture.summaryJobs.recoverInterruptedJobs(), 1);
  assert.equal(fixture.summaryJobs.getJob(job.id).status, "dispatching");

  const results = await fixture.dispatcher.onReconnect();
  assert.equal(results.length, 1);
  assert.equal(results[0].dispatched, true);
  assert.equal(results[0].replay, true);
  assert.equal(results[0].attempt_id, originalAttempt.id);
  assert.equal(fixture.sends[0].nonce, originalDiscordNonce);
  assert.equal(fixture.summaryJobs.getJob(job.id).status, "awaiting_agent");
  fixture.db.close();
});

test("retries use a stable Discord nonce and cannot create duplicate completion", async () => {
  const fixture = createFixture({
    sendMessage: async (_payload, call) => {
      if (call === 1) throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
      return { id: "discord-deduplicated-message" };
    },
  });
  const job = fixture.createJob();

  const first = await fixture.dispatcher.dispatchJob(job.id);
  assert.equal(first.queued, true);
  fixture.advance(1_001);
  const second = await fixture.dispatcher.dispatchPending();

  assert.equal(second[0].dispatched, true);
  assert.equal(fixture.sends.length, 2);
  assert.equal(fixture.sends[0].nonce, fixture.sends[1].nonce);
  assert.equal(fixture.sends[0].enforceNonce, true);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM meeting_summary_attempts WHERE job_id=?").get(job.id).count, 2);
  assert.equal(fixture.summaryJobs.getJob(job.id).status, "awaiting_agent");
  fixture.db.close();
});

test("coalesces concurrent processing of the same job", async () => {
  let release;
  const pendingSend = new Promise(resolve => { release = resolve; });
  const fixture = createFixture({ sendMessage: () => pendingSend });
  const job = fixture.createJob();

  const first = fixture.dispatcher.dispatchJob(job.id);
  const second = await fixture.dispatcher.dispatchJob(job.id);
  assert.equal(second.reason, "already_dispatching");
  release({ id: "discord-message-1" });
  assert.equal((await first).dispatched, true);
  assert.equal(fixture.sends.length, 1);
  fixture.db.close();
});

test("exports the declared payload schema", () => {
  assert.equal(PAYLOAD_SCHEMA, "SILLOK_SUMMARY_JOB_V1");
});
