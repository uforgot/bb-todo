const DEFAULT_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
const DEFAULT_MAX_ATTEMPTS = 5;

function calculateBackoffMs(attemptCount, {
  scheduleMs = DEFAULT_BACKOFF_MS,
  jitterRatio = 0.2,
  random = Math.random,
} = {}) {
  const index = Math.max(0, Math.min(Number(attemptCount || 1) - 1, scheduleMs.length - 1));
  const base = Math.max(0, Number(scheduleMs[index]) || 0);
  const jitter = base * Math.max(0, jitterRatio) * ((random() * 2) - 1);
  return Math.max(0, Math.round(base + jitter));
}

function createSillokSummaryReconciler({
  summaryJobs,
  dispatcher = null,
  now = () => new Date(),
  intervalMs = 15_000,
  dispatchTimeoutMs = 20_000,
  acknowledgementTimeoutMs = 120_000,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  backoffScheduleMs = DEFAULT_BACKOFF_MS,
  jitterRatio = 0.2,
  random = Math.random,
  logger = console,
} = {}) {
  if (!summaryJobs) throw new Error("summaryJobs service is required");
  let timer = null;
  let running = null;

  const due = (timestamp, timeoutMs, currentMs) => {
    if (!timestamp) return false;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) && parsed + timeoutMs <= currentMs;
  };

  function nextAttemptAt(attemptCount) {
    const delay = calculateBackoffMs(attemptCount, {
      scheduleMs: backoffScheduleMs,
      jitterRatio,
      random,
    });
    return new Date(now().getTime() + delay).toISOString();
  }

  function exhaustOrSchedule(job, code, message) {
    const attempt = job.current_attempt;
    if (!attempt?.id || !attempt?.nonce) return null;
    const exhausted = Number(job.attempt_count || 0) >= maxAttempts;
    return summaryJobs.failAttempt(job.id, {
      attemptId: attempt.id,
      nonce: attempt.nonce,
      errorCode: exhausted ? "attempt_budget_exhausted" : code,
      error: exhausted ? `summary attempt budget exhausted after ${job.attempt_count} attempts` : message,
      retryable: !exhausted,
      nextAttemptAt: exhausted ? null : nextAttemptAt(job.attempt_count),
    });
  }

  async function runOnce() {
    if (running) return running;
    running = (async () => {
      const current = now();
      const currentMs = current.getTime();
      const rows = summaryJobs.listJobs({ status: "all", limit: 200 });
      const results = [];

      for (const row of rows) {
        if (!["queued", "dispatching", "awaiting_agent", "processing", "retry_wait"].includes(row.status)) continue;
        const job = summaryJobs.getJob(row.id, { includeNonce: true });
        try {
          if (job.status === "queued" && job.attempt_count >= maxAttempts) {
            const updated = summaryJobs.deadLetterJob(job.id, {
              errorCode: "attempt_budget_exhausted",
              error: `summary attempt budget exhausted after ${job.attempt_count} attempts`,
            });
            results.push({ job_id: job.id, action: "dead_lettered", status: updated.status });
          } else if (job.status === "dispatching" && due(job.current_attempt?.created_at, dispatchTimeoutMs, currentMs)) {
            const updated = exhaustOrSchedule(job, "dispatch_timeout", "Discord dispatch acknowledgement timed out");
            results.push({ job_id: job.id, action: updated.status === "failed" ? "dead_lettered" : "retry_scheduled", status: updated.status });
          } else if (job.status === "awaiting_agent" && due(job.current_attempt?.dispatched_at, acknowledgementTimeoutMs, currentMs)) {
            const updated = exhaustOrSchedule(job, "agent_ack_timeout", "OpenClaw Agent acknowledgement timed out");
            results.push({ job_id: job.id, action: updated.status === "failed" ? "dead_lettered" : "retry_scheduled", status: updated.status });
          } else if (job.status === "processing" && job.current_attempt?.lease_expires_at && job.current_attempt.lease_expires_at <= current.toISOString()) {
            const updated = exhaustOrSchedule(job, "processing_lease_expired", "OpenClaw Agent processing lease expired");
            results.push({ job_id: job.id, action: updated.status === "failed" ? "dead_lettered" : "retry_scheduled", status: updated.status });
          } else if (job.status === "retry_wait" && (!job.next_attempt_at || job.next_attempt_at <= current.toISOString())) {
            if (job.attempt_count >= maxAttempts) {
              const updated = summaryJobs.deadLetterJob(job.id, {
                errorCode: "attempt_budget_exhausted",
                error: `summary attempt budget exhausted after ${job.attempt_count} attempts`,
                expectedStatuses: ["retry_wait"],
              });
              results.push({ job_id: job.id, action: "dead_lettered", status: updated.status });
            } else {
              const updated = summaryJobs.retryJob(job.id);
              results.push({ job_id: job.id, action: "requeued", status: updated.status });
            }
          }
        } catch (error) {
          if (!["stale_attempt", "invalid_attempt_state", "invalid_job_state"].includes(error?.code)) throw error;
          results.push({ job_id: job.id, action: "concurrent_change", status: null });
        }
      }

      if (results.length) logger.log(`[sillok-summary-reconciler] transitions=${results.length}`);
      return { scanned: rows.length, transitions: results };
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  async function onDiscordReconnect() {
    const reconciled = await runOnce();
    const dispatched = dispatcher?.onReconnect ? await dispatcher.onReconnect() : [];
    return { reconciled, dispatched };
  }

  function start() {
    if (timer) return { stop, runOnce, onDiscordReconnect };
    void runOnce().catch(error => logger.error("[sillok-summary-reconciler] initial scan failed:", error?.message || error));
    if (intervalMs > 0) {
      timer = setInterval(() => {
        void runOnce().catch(error => logger.error("[sillok-summary-reconciler] scan failed:", error?.message || error));
      }, intervalMs);
      timer.unref?.();
    }
    logger.log("[sillok-summary-reconciler] started");
    return { stop, runOnce, onDiscordReconnect };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runOnce, onDiscordReconnect, start, stop };
}

module.exports = {
  DEFAULT_BACKOFF_MS,
  calculateBackoffMs,
  createSillokSummaryReconciler,
};
