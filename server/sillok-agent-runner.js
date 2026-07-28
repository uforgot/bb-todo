const { buildSillokDispatchPayload } = require("./sillok-summary-dispatcher");

function createSillokAgentRunner({
  summaryJobs,
  handler,
  targetUserId,
  intervalMs = 5_000,
  logger = console,
} = {}) {
  if (!summaryJobs) throw new Error("summaryJobs service is required");
  if (!handler?.handle) throw new Error("Sillok summary handler is required");
  if (!targetUserId) throw new Error("targetUserId is required");
  const inFlight = new Set();
  let timer = null;
  let scanPromise = null;

  async function runJob(jobId) {
    if (inFlight.has(jobId)) return { status: "skipped", reason: "already_processing", job_id: jobId };
    inFlight.add(jobId);
    try {
      const job = summaryJobs.getJob(jobId, { includeNonce: true });
      if (job.status !== "awaiting_agent") return { status: "skipped", reason: "not_awaiting_agent", job_id: jobId };
      const record = summaryJobs.startAttempt(jobId);
      const packet = buildSillokDispatchPayload({
        job: record.job,
        recordNumber: record.record_number,
        targetUserId,
      });
      return await handler.handle(packet);
    } finally {
      inFlight.delete(jobId);
    }
  }

  async function runPending({ limit = 10 } = {}) {
    if (scanPromise) return scanPromise;
    scanPromise = (async () => {
      const jobs = summaryJobs.listJobs({ status: "awaiting_agent", limit });
      const results = [];
      for (const job of jobs) {
        try {
          results.push(await runJob(job.id));
        } catch (error) {
          results.push({ status: "failed", job_id: job.id, error_code: error?.failure?.code || error?.code || "agent_runner_failed" });
        }
      }
      return results;
    })();
    try {
      return await scanPromise;
    } finally {
      scanPromise = null;
    }
  }

  function start() {
    if (timer) return { stop, runPending };
    void runPending().catch(error => logger.error("[sillok-agent-runner] initial scan failed:", error?.message || error));
    if (intervalMs > 0) {
      timer = setInterval(() => {
        void runPending().catch(error => logger.error("[sillok-agent-runner] scan failed:", error?.message || error));
      }, intervalMs);
      timer.unref?.();
    }
    logger.log("[sillok-agent-runner] started");
    return { stop, runPending };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runJob, runPending, start, stop };
}

module.exports = { createSillokAgentRunner };
