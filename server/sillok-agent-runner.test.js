const test = require("node:test");
const assert = require("node:assert/strict");
const { createSillokAgentRunner } = require("./sillok-agent-runner");

test("claims only awaiting jobs through the memory-aware handler", async () => {
  const handled = [];
  const job = {
    id: "job-1",
    record_id: "record-1",
    generation: 1,
    status: "awaiting_agent",
    current_attempt: { id: "attempt-1", nonce: "valid-nonce-1234" },
  };
  const summaryJobs = {
    listJobs: ({ status }) => status === "awaiting_agent" ? [job] : [],
    getJob: () => job,
    startAttempt: () => ({ job, record_number: 51, replay: true }),
  };
  const runner = createSillokAgentRunner({
    summaryJobs,
    targetUserId: "1471495923400970377",
    intervalMs: 0,
    logger: { log() {}, error() {} },
    handler: { async handle(packet) { handled.push(packet); return { status: "completed", job_id: job.id }; } },
  });
  const results = await runner.runPending();
  assert.equal(results[0].status, "completed");
  assert.match(handled[0], /\[SILLOK_SUMMARY_JOB_V1\]/);
  assert.match(handled[0], /record_number: 51/);
  assert.match(handled[0], /nonce: valid-nonce-1234/);
});

test("coalesces duplicate runner work", async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const job = {
    id: "job-1", record_id: "record-1", generation: 1, status: "awaiting_agent",
    current_attempt: { id: "attempt-1", nonce: "valid-nonce-1234" },
  };
  const runner = createSillokAgentRunner({
    summaryJobs: {
      listJobs: () => [job],
      getJob: () => job,
      startAttempt: () => ({ job, record_number: 51, replay: true }),
    },
    targetUserId: "1471495923400970377",
    intervalMs: 0,
    logger: { log() {}, error() {} },
    handler: { async handle() { await wait; return { status: "completed" }; } },
  });
  const first = runner.runJob(job.id);
  const duplicate = await runner.runJob(job.id);
  assert.equal(duplicate.reason, "already_processing");
  release();
  await first;
});
