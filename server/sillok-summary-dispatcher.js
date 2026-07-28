const crypto = require("node:crypto");

const PAYLOAD_SCHEMA = "SILLOK_SUMMARY_JOB_V1";
const DEFAULT_CHANNEL_ID = "1475129999991509094";
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_SEND_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 30_000;

function buildDiscordMessageNonce(jobId, generation) {
  return crypto
    .createHash("sha256")
    .update(`${jobId}:${generation}`)
    .digest("hex")
    .slice(0, 24);
}

function buildSillokDispatchPayload({ job, recordNumber, targetUserId }) {
  const attempt = job?.current_attempt;
  if (!job?.id || !job?.record_id || !attempt?.id || !attempt?.nonce) {
    throw new Error("summary dispatch locator is incomplete");
  }
  if (!targetUserId) throw new Error("summary dispatch target user is required");

  return [
    `<@${targetUserId}>`,
    `[${PAYLOAD_SCHEMA}]`,
    `record_id: ${job.record_id}`,
    `record_number: ${recordNumber ?? ""}`,
    `job_id: ${job.id}`,
    `attempt_id: ${attempt.id}`,
    `nonce: ${attempt.nonce}`,
    `callback: /api/meeting-summary-jobs/${job.id}/result`,
  ].join("\n");
}

function normalizeDispatchError(error) {
  const statusCode = Number(error?.statusCode) || null;
  let code = String(error?.code || "discord_send_failed").slice(0, 80);
  if (statusCode === 401 || statusCode === 403) code = "discord_permission_denied";
  else if (statusCode === 429) code = "discord_rate_limited";
  else if (/timed? out/i.test(String(error?.message || ""))) code = "discord_timeout";
  return {
    code,
    message: String(error?.message || error || "Discord send failed").slice(0, 1000),
  };
}

function withTimeout(promise, timeoutMs) {
  if (!(timeoutMs > 0)) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error("Discord summary dispatch timed out"), {
          code: "discord_timeout",
        });
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function createSillokSummaryDispatcher({
  summaryJobs,
  sendMessage,
  channelId = DEFAULT_CHANNEL_ID,
  targetUserId,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  now = () => new Date(),
  logger = console,
} = {}) {
  if (!summaryJobs) throw new Error("summaryJobs service is required");
  if (typeof sendMessage !== "function") throw new Error("sendMessage is required");
  if (!channelId) throw new Error("Discord summary channel is required");
  if (!targetUserId) throw new Error("Discord summary target user is required");

  const inFlight = new Set();
  let timer = null;
  let scanPromise = null;

  async function dispatchJob(jobId) {
    if (inFlight.has(jobId)) return { dispatched: false, reason: "already_dispatching" };
    inFlight.add(jobId);
    try {
      const started = summaryJobs.startAttempt(jobId);
      const { job, record_number: recordNumber } = started;
      const attempt = job.current_attempt;
      if (started.replay && job.status !== "dispatching") {
        return {
          dispatched: false,
          reason: "already_dispatched",
          job_id: job.id,
          attempt_id: attempt?.id || null,
          message_id: attempt?.discord_message_id || null,
        };
      }
      const content = buildSillokDispatchPayload({ job, recordNumber, targetUserId });
      const discordNonce = buildDiscordMessageNonce(job.id, job.generation);

      try {
        const message = await withTimeout(Promise.resolve(sendMessage({
          channelId,
          content,
          allowedUserIds: [targetUserId],
          nonce: discordNonce,
          enforceNonce: true,
          timeoutMs: sendTimeoutMs,
        })), sendTimeoutMs);
        if (!message?.id) throw new Error("Discord summary dispatch returned no message id");

        const updated = summaryJobs.markDispatched(job.id, {
          attemptId: attempt.id,
          nonce: attempt.nonce,
          channelId,
          messageId: message.id,
        });
        logger.log(`[sillok-summary-dispatcher] dispatched job=${job.id} message=${message.id}`);
        return {
          dispatched: true,
          replay: Boolean(started.replay),
          job_id: job.id,
          attempt_id: attempt.id,
          channel_id: channelId,
          message_id: message.id,
          job: updated,
        };
      } catch (error) {
        const normalized = normalizeDispatchError(error);
        try {
          summaryJobs.requeueDispatchFailure(job.id, {
            attemptId: attempt.id,
            nonce: attempt.nonce,
            errorCode: normalized.code,
            error: normalized.message,
            nextAttemptAt: new Date(now().getTime() + retryDelayMs).toISOString(),
          });
        } catch (stateError) {
          if (stateError?.code !== "invalid_attempt_state" && stateError?.code !== "stale_attempt") throw stateError;
        }
        logger.error(`[sillok-summary-dispatcher] send failed job=${job.id}: ${normalized.message}`);
        return {
          dispatched: false,
          queued: true,
          job_id: job.id,
          error_code: normalized.code,
          error: normalized.message,
        };
      }
    } finally {
      inFlight.delete(jobId);
    }
  }

  async function dispatchPending({ limit = 20 } = {}) {
    if (scanPromise) return scanPromise;
    scanPromise = (async () => {
      const pending = summaryJobs.listJobs({ status: "pending", limit });
      const interruptedDispatches = summaryJobs.listJobs({ status: "dispatching", limit });
      const jobs = [...new Map(
        [...interruptedDispatches, ...pending].map(job => [job.id, job]),
      ).values()].slice(0, limit);
      const results = [];
      for (const job of jobs) results.push(await dispatchJob(job.id));
      return results;
    })();
    try {
      return await scanPromise;
    } finally {
      scanPromise = null;
    }
  }

  function start() {
    if (timer) return { stop, dispatchPending };
    void dispatchPending().catch(error => {
      logger.error("[sillok-summary-dispatcher] initial scan failed:", error?.message || error);
    });
    if (pollIntervalMs > 0) {
      timer = setInterval(() => {
        void dispatchPending().catch(error => {
          logger.error("[sillok-summary-dispatcher] scan failed:", error?.message || error);
        });
      }, pollIntervalMs);
      timer.unref?.();
    }
    logger.log(`[sillok-summary-dispatcher] started channel=${channelId}`);
    return { stop, dispatchPending };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    dispatchJob,
    dispatchPending,
    onReconnect: dispatchPending,
    start,
    stop,
  };
}

module.exports = {
  PAYLOAD_SCHEMA,
  DEFAULT_CHANNEL_ID,
  buildDiscordMessageNonce,
  buildSillokDispatchPayload,
  createSillokSummaryDispatcher,
};
