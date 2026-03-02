#!/usr/bin/env node
/**
 * Local Usage API Server
 * Exposes Claude (macOS plist) + Kimi (Moonshot API) usage data + Cron status (SQLite)
 * Designed to run behind Tailscale Funnel
 */

const http = require("http");
const { execSync } = require("child_process");
const https = require("https");
const plist = require("simple-plist");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PORT = process.env.USAGE_PORT || 3100;
const API_KEY = process.env.USAGE_API_KEY;
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY;
const CRON_JOBS_PATH = process.env.CRON_JOBS_PATH || path.join(require("os").homedir(), ".openclaw/cron/jobs.json");
const CRON_POLL_INTERVAL = parseInt(process.env.CRON_POLL_INTERVAL || "300000"); // 5 min
const DB_PATH = process.env.CRON_DB_PATH || path.join(__dirname, "cron.db");

if (!API_KEY) {
  console.error("❌ USAGE_API_KEY is required");
  process.exit(1);
}

// --- SQLite Setup ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS cron_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    job_name TEXT,
    status TEXT NOT NULL,
    error TEXT,
    duration_ms INTEGER,
    consecutive_errors INTEGER DEFAULT 0,
    ran_at TEXT NOT NULL,
    polled_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id, ran_at DESC);

  CREATE TABLE IF NOT EXISTS cron_jobs (
    job_id TEXT PRIMARY KEY,
    job_name TEXT,
    schedule TEXT,
    enabled INTEGER DEFAULT 1,
    last_status TEXT,
    last_run_at TEXT,
    last_duration_ms INTEGER,
    consecutive_errors INTEGER DEFAULT 0,
    next_run_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
console.log(`✅ SQLite DB ready: ${DB_PATH}`);

// --- Cron Poller (reads jobs.json → SQLite) ---
const upsertJob = db.prepare(`
  INSERT INTO cron_jobs (job_id, job_name, schedule, enabled, last_status, last_run_at, last_duration_ms, consecutive_errors, next_run_at, updated_at)
  VALUES (@job_id, @job_name, @schedule, @enabled, @last_status, @last_run_at, @last_duration_ms, @consecutive_errors, @next_run_at, datetime('now'))
  ON CONFLICT(job_id) DO UPDATE SET
    job_name=@job_name, schedule=@schedule, enabled=@enabled,
    last_status=@last_status, last_run_at=@last_run_at, last_duration_ms=@last_duration_ms,
    consecutive_errors=@consecutive_errors, next_run_at=@next_run_at, updated_at=datetime('now')
`);

const insertRun = db.prepare(`
  INSERT INTO cron_runs (job_id, job_name, status, error, duration_ms, consecutive_errors, ran_at)
  VALUES (@job_id, @job_name, @status, @error, @duration_ms, @consecutive_errors, @ran_at)
`);

const getLastRun = db.prepare(`SELECT ran_at FROM cron_runs WHERE job_id = ? ORDER BY ran_at DESC LIMIT 1`);

function pollCronJobs() {
  try {
    if (!fs.existsSync(CRON_JOBS_PATH)) {
      console.warn("[cron-poll] jobs.json not found:", CRON_JOBS_PATH);
      return;
    }
    const raw = fs.readFileSync(CRON_JOBS_PATH, "utf-8");
    const data = JSON.parse(raw);
    const jobs = data.jobs || data || [];

    let updated = 0;
    for (const job of jobs) {
      const state = job.state || {};
      const schedule = job.schedule || {};
      const schedStr = schedule.expr || (schedule.kind === "every" ? `every ${schedule.everyMs}ms` : "");
      const lastRunAt = state.lastRunAtMs ? new Date(state.lastRunAtMs).toISOString() : null;
      const nextRunAt = state.nextRunAtMs ? new Date(state.nextRunAtMs).toISOString() : null;

      upsertJob.run({
        job_id: job.id,
        job_name: job.name || null,
        schedule: schedStr,
        enabled: job.enabled !== false ? 1 : 0,
        last_status: state.lastStatus || null,
        last_run_at: lastRunAt,
        last_duration_ms: state.lastDurationMs || null,
        consecutive_errors: state.consecutiveErrors || 0,
        next_run_at: nextRunAt,
      });

      // Insert into history only if new run detected
      if (lastRunAt) {
        const lastRecorded = getLastRun.get(job.id);
        if (!lastRecorded || lastRecorded.ran_at !== lastRunAt) {
          insertRun.run({
            job_id: job.id,
            job_name: job.name || null,
            status: state.lastStatus || "unknown",
            error: state.lastError || null,
            duration_ms: state.lastDurationMs || null,
            consecutive_errors: state.consecutiveErrors || 0,
            ran_at: lastRunAt,
          });
          updated++;
        }
      }
    }
    if (updated > 0) {
      console.log(`[cron-poll] ${updated} new run(s) recorded, ${jobs.length} jobs synced`);
    }
  } catch (e) {
    console.error("[cron-poll] error:", e.message);
  }
}

// Initial poll + interval
pollCronJobs();
setInterval(pollCronJobs, CRON_POLL_INTERVAL);
console.log(`✅ Cron poller started (interval: ${CRON_POLL_INTERVAL / 1000}s, source: ${CRON_JOBS_PATH})`);

// --- Claude Usage (macOS plist) ---
function getClaudeUsage() {
  try {
    const plistPath = "/tmp/claude-usage-prefs.plist";
    execSync(
      "defaults export HamedElfayome.Claude-Usage /tmp/claude-usage-prefs.plist",
      { timeout: 5000 }
    );

    const data = plist.readFileSync(plistPath);
    const profiles = JSON.parse(
      Buffer.isBuffer(data.profiles_v3)
        ? data.profiles_v3.toString("utf-8")
        : data.profiles_v3 || "[]"
    );

    if (!profiles.length) return null;

    const cu = profiles[0].claudeUsage || {};
    const appleEpoch = new Date("2001-01-01T00:00:00Z");

    const resetTime = new Date(
      appleEpoch.getTime() + (cu.weeklyResetTime || 0) * 1000
    );
    const lastUpdated = new Date(
      appleEpoch.getTime() + (cu.lastUpdated || 0) * 1000
    );

    const sessionResetTime = new Date(
      appleEpoch.getTime() + (cu.sessionResetTime || 0) * 1000
    );

    return {
      plan: "Max",
      weekly_tokens_used: cu.weeklyTokensUsed || 0,
      weekly_limit: cu.weeklyLimit || 0,
      weekly_percentage: cu.weeklyPercentage || 0,
      sonnet_weekly_tokens_used: cu.sonnetWeeklyTokensUsed || 0,
      sonnet_weekly_percentage: cu.sonnetWeeklyPercentage || 0,
      opus_weekly_tokens_used: cu.opusWeeklyTokensUsed || 0,
      opus_weekly_percentage: cu.opusWeeklyPercentage || 0,
      session_percentage: cu.sessionPercentage || 0,
      session_reset_time: sessionResetTime.toISOString(),
      weekly_reset_time: resetTime.toISOString(),
      last_updated: lastUpdated.toISOString(),
    };
  } catch (e) {
    console.error("Claude usage error:", e.message);
    return null;
  }
}

// --- Kimi Balance (Moonshot API) ---
function getKimiBalance() {
  return new Promise((resolve) => {
    if (!MOONSHOT_API_KEY) {
      resolve(null);
      return;
    }

    const req = https.request(
      {
        hostname: "api.moonshot.ai",
        path: "/v1/users/me/balance",
        method: "GET",
        headers: { Authorization: `Bearer ${MOONSHOT_API_KEY}` },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const b = data.data;
            resolve({
              current_balance: parseFloat(b.available_balance) || 0,
              cash_balance: parseFloat(b.cash_balance) || 0,
              voucher_balance: parseFloat(b.voucher_balance) || 0,
              currency: "USD",
            });
          } catch (e) {
            console.error("Kimi parse error:", e.message);
            resolve(null);
          }
        });
      }
    );
    req.on("error", (e) => {
      console.error("Kimi request error:", e.message);
      resolve(null);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Auth check for all routes
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${API_KEY}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  try {
    if (url.pathname === "/usage" || url.pathname === "/usage/") {
      const [claude, kimi] = await Promise.all([
        getClaudeUsage(),
        getKimiBalance(),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ claude, kimi, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/claude") {
      const claude = getClaudeUsage();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ claude, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/kimi") {
      const kimi = await getKimiBalance();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ kimi, timestamp: new Date().toISOString() }));

    // --- Cron Jobs API ---
    } else if (url.pathname === "/cron-jobs" && req.method === "GET") {
      const jobs = db.prepare("SELECT * FROM cron_jobs ORDER BY job_name").all();
      // Transform to match bb-todo expected format
      const formatted = {
        jobs: jobs.map(j => ({
          id: j.job_id,
          name: j.job_name,
          enabled: j.enabled === 1,
          schedule: { expr: j.schedule },
          state: {
            lastStatus: j.last_status,
            lastRunAtMs: j.last_run_at ? new Date(j.last_run_at).getTime() : null,
            lastDurationMs: j.last_duration_ms,
            consecutiveErrors: j.consecutive_errors,
            nextRunAtMs: j.next_run_at ? new Date(j.next_run_at).getTime() : null,
          },
        })),
        version: 1,
        source: "sqlite",
        polledAt: new Date().toISOString(),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(formatted));

    } else if (url.pathname === "/cron-runs" && req.method === "GET") {
      const jobId = url.searchParams.get("jobId");
      const limit = parseInt(url.searchParams.get("limit") || "50");
      let rows;
      if (jobId) {
        rows = db.prepare("SELECT * FROM cron_runs WHERE job_id = ? ORDER BY ran_at DESC LIMIT ?").all(jobId, limit);
      } else {
        rows = db.prepare("SELECT * FROM cron_runs ORDER BY ran_at DESC LIMIT ?").all(limit);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ runs: rows }));

    } else if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (e) {
    console.error("Server error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal error" }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Usage API server running on port ${PORT}`);
});
