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
const sharp = require("sharp");

const PORT = process.env.USAGE_PORT || 3100;
const API_KEY = process.env.USAGE_API_KEY;
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY;
const ANTHROPIC_ADMIN_API_KEY = process.env.ANTHROPIC_ADMIN_API_KEY;
const OPENAI_ADMIN_API_KEY = process.env.OPENAI_ADMIN_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
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
    payload_message TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    emoji TEXT,
    priority INTEGER NOT NULL DEFAULT 99,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, name)
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    category_id INTEGER REFERENCES categories(id),
    status TEXT NOT NULL DEFAULT 'todo'
      CHECK (status IN ('todo', 'in_progress', 'done', 'review', 'archived')),
    title TEXT NOT NULL,
    content TEXT,
    sort_order INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migration: review_count
try { db.exec("ALTER TABLE items ADD COLUMN review_count INTEGER DEFAULT 0"); } catch {}
// Migration: is_today
try { db.exec("ALTER TABLE items ADD COLUMN is_today INTEGER DEFAULT 0"); } catch {}
// Migration: review_emoji
try { db.exec("ALTER TABLE items ADD COLUMN review_emoji TEXT"); } catch {}
// Migration: owner
try { db.exec("ALTER TABLE items ADD COLUMN owner TEXT"); } catch {}
// Migration: discord channel mapping
try { db.exec("ALTER TABLE projects ADD COLUMN discord_channel_id TEXT"); } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN discord_thread_id TEXT"); } catch {}
// Discord channels table
db.exec(`
  CREATE TABLE IF NOT EXISTS discord_channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'channel',
    parent_id TEXT
  );
`);
// Migration: parent_id
try { db.exec("ALTER TABLE discord_channels ADD COLUMN parent_id TEXT"); } catch {}
// Seed discord channels (upsert with parent_id)
const seedChannels = [
  // Channels
  { id: "1472134667946954894", name: "bb-dingdong" },
  { id: "1472162937648189615", name: "bb-private" },
  { id: "1475129999991509094", name: "bb-write" },
  { id: "1475344740290527363", name: "bb-test" },
  { id: "1476069327731032085", name: "kia-renewal" },
  { id: "1476412197658689536", name: "designsamsung" },
  { id: "1477270129539813387", name: "bb-budget" },
  { id: "1476790981767467099", name: "bb-test-hachi" },
  { id: "1478213782365798503", name: "bb-euri" },
  { id: "1479067067704676384", name: "df" },
  // Threads (with parent_id)
  { id: "1481459571703939262", name: "bb-app 개발", type: "thread", parent_id: "1472162937648189615" },
  { id: "1481838146936115251", name: "df-workapp", type: "thread", parent_id: "1479067067704676384" },
  { id: "1482347838116724776", name: "cms 포팅 이슈", type: "thread", parent_id: "1476069327731032085" },
  { id: "1482006987758637066", name: "cms 에러 리포트", type: "thread", parent_id: "1476069327731032085" },
  { id: "1481841554095345736", name: "도훈공장", type: "thread", parent_id: "1476069327731032085" },
  { id: "1481841285236261025", name: "inyoung", type: "thread", parent_id: "1476069327731032085" },
  { id: "1481837585306353664", name: "google analytics", type: "thread", parent_id: "1476069327731032085" },
  { id: "1481835294385766470", name: "csw", type: "thread", parent_id: "1476069327731032085" },
];
const upsertChannel = db.prepare("INSERT INTO discord_channels (id, name, type, parent_id) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, parent_id=excluded.parent_id");
for (const ch of seedChannels) upsertChannel.run(ch.id, ch.name, ch.type || "channel", ch.parent_id || null);

// --- Discord Channel Sync ---
const GUILD_ID = "1471498460271218894";

async function syncDiscordChannels() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) { console.log("[discord-sync] no bot token, skipping"); return; }

  const fetchJson = (path) => new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "discord.com", path, method: "GET",
      headers: { "Authorization": `Bot ${botToken}` }
    }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); } });
    });
    req.on("error", reject); req.end();
  });

  try {
    // 1. Get guild channels
    const channels = await fetchJson(`/api/v10/guilds/${GUILD_ID}/channels`);
    const textChannels = channels.filter(c => c.type === 0); // GUILD_TEXT
    for (const ch of textChannels) {
      upsertChannel.run(ch.id, ch.name, "channel", null);
    }

    // 2. Get active threads
    const threadData = await fetchJson(`/api/v10/guilds/${GUILD_ID}/threads/active`);
    const threads = threadData.threads || [];
    for (const t of threads) {
      upsertChannel.run(t.id, t.name, "thread", t.parent_id || null);
    }

    console.log(`[discord-sync] synced ${textChannels.length} channels + ${threads.length} threads`);
  } catch (e) {
    console.error("[discord-sync] error:", e.message);
  }
}

// Sync on startup + every 30 minutes
syncDiscordChannels();
setInterval(syncDiscordChannels, 30 * 60 * 1000);

console.log(`✅ SQLite DB ready: ${DB_PATH}`);

// --- Cron Poller (reads jobs.json → SQLite) ---
const upsertJob = db.prepare(`
  INSERT INTO cron_jobs (job_id, job_name, schedule, enabled, last_status, last_run_at, last_duration_ms, consecutive_errors, next_run_at, payload_message, updated_at)
  VALUES (@job_id, @job_name, @schedule, @enabled, @last_status, @last_run_at, @last_duration_ms, @consecutive_errors, @next_run_at, @payload_message, datetime('now'))
  ON CONFLICT(job_id) DO UPDATE SET
    job_name=@job_name, schedule=@schedule, enabled=@enabled,
    last_status=@last_status, last_run_at=@last_run_at, last_duration_ms=@last_duration_ms,
    consecutive_errors=@consecutive_errors, next_run_at=@next_run_at, payload_message=@payload_message, updated_at=datetime('now')
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
        payload_message: (job.payload && job.payload.message) || null,
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

// --- Claude Usage (macOS plist / Anthropic Usage API) ---
function getClaudeUsageFromPlist() {
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
      source: "local-plist",
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
    console.error("Claude plist usage error:", e.message);
    return null;
  }
}

async function getClaudeUsageFromApi() {
  if (!ANTHROPIC_ADMIN_API_KEY) return null;

  const endingAt = new Date().toISOString();
  const startingAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const path = `/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(startingAt)}&ending_at=${encodeURIComponent(endingAt)}&bucket_width=1d&group_by[]=model`;

  const res = await httpsJson({
    hostname: 'api.anthropic.com',
    path,
    headers: {
      'x-api-key': ANTHROPIC_ADMIN_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    timeout: 15000,
  });

  if (res.status !== 200 || !res.data) {
    console.error('Claude API usage error:', res.status, res.error || res.parseError || 'unknown');
    return null;
  }

  const buckets = res.data.data || [];
  let totalInput = 0;
  let totalOutput = 0;
  let sonnet = 0;
  let opus = 0;

  for (const bucket of buckets) {
    for (const item of bucket.results || []) {
      const input = item.input_tokens || 0;
      const output = item.output_tokens || 0;
      const total = input + output;
      totalInput += input;
      totalOutput += output;
      const model = String(item.model || '').toLowerCase();
      if (model.includes('sonnet')) sonnet += total;
      if (model.includes('opus')) opus += total;
    }
  }

  const total = totalInput + totalOutput;
  return {
    plan: 'API',
    source: 'anthropic-usage-api',
    weekly_tokens_used: total,
    weekly_limit: 0,
    weekly_percentage: 0,
    sonnet_weekly_tokens_used: sonnet,
    sonnet_weekly_percentage: 0,
    opus_weekly_tokens_used: opus,
    opus_weekly_percentage: 0,
    session_percentage: 0,
    session_reset_time: new Date().toISOString(),
    weekly_reset_time: endingAt,
    last_updated: new Date().toISOString(),
  };
}

async function getClaudeUsage() {
  const apiUsage = await getClaudeUsageFromApi();
  if (apiUsage) return apiUsage;
  return getClaudeUsageFromPlist();
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

// --- OpenClaw/Codex quota snapshot ---
let codexQuotaCache = {
  value: null,
  fetchedAt: 0,
  inflight: null,
};

function formatResetRemaining(targetMs, now = Date.now()) {
  if (!targetMs) return null;
  const diffMs = targetMs - now;
  if (diffMs <= 0) return "now";

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ${hours % 24}h`;

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(targetMs));
}

function getCodexAuthProfile() {
  try {
    const authPath = path.join(require("os").homedir(), ".openclaw/agents/main/agent/auth-profiles.json");
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const profiles = parsed?.profiles || {};
    const preferred = parsed?.lastGood?.["openai-codex"];
    const profile = (preferred && profiles[preferred]) || profiles["openai-codex:default"] || Object.values(profiles).find((entry) => entry?.provider === "openai-codex");
    if (!profile?.access) return null;
    const tokenPayload = JSON.parse(Buffer.from(profile.access.split(".")[1], "base64url").toString("utf8"));
    const embeddedAccountId = tokenPayload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    return {
      access: profile.access,
      accountId: profile.accountId || embeddedAccountId || undefined,
      email: profile.email || tokenPayload?.["https://api.openai.com/profile"]?.email || null,
    };
  } catch (e) {
    console.error("Codex auth profile error:", e.message);
    return null;
  }
}

async function getOpenClawCodexQuota() {
  const now = Date.now();
  if (codexQuotaCache.inflight) {
    return codexQuotaCache.inflight;
  }

  codexQuotaCache.inflight = (async () => {
    try {
      const auth = getCodexAuthProfile();
      if (!auth?.access) return null;

      const headers = {
        Authorization: `Bearer ${auth.access}`,
        "User-Agent": "CodexBar",
        Accept: "application/json",
        ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
      };

      const res = await httpsJson({
        hostname: "chatgpt.com",
        path: "/backend-api/wham/usage",
        headers,
        timeout: 15000,
      });

      if (res.status !== 200 || !res.data) {
        console.error("Codex wham usage error:", res.status, res.error || res.parseError || res.raw || "unknown");
        return codexQuotaCache.value || null;
      }

      const rateLimit = res.data?.rate_limit || {};
      const fiveHour = rateLimit.primary_window || null;
      const week = rateLimit.secondary_window || null;

      console.log(`[codex-quota] fetchedAt=${new Date().toISOString()} email=${auth.email || "unknown"} accountId=${auth.accountId || "none"} raw=${JSON.stringify({primary_window: fiveHour, secondary_window: week})}`);

      const value = {
        provider: "codex",
        plan: res.data?.plan_type ? `${res.data.plan_type} ($${Number(res.data?.credits?.balance || 0).toFixed(2)})` : null,
        five_hour_left_percent: fiveHour ? Math.max(0, Math.min(100, 100 - (fiveHour.used_percent || 0))) : null,
        five_hour_reset_in: fiveHour?.reset_at ? formatResetRemaining(fiveHour.reset_at * 1000, now) : null,
        five_hour_reset_at: fiveHour?.reset_at ? new Date(fiveHour.reset_at * 1000).toISOString() : null,
        week_left_percent: week ? Math.max(0, Math.min(100, 100 - (week.used_percent || 0))) : null,
        week_reset_in: week?.reset_at ? formatResetRemaining(week.reset_at * 1000, now) : null,
        week_reset_at: week?.reset_at ? new Date(week.reset_at * 1000).toISOString() : null,
        source: "chatgpt.com/backend-api/wham/usage",
      };

      codexQuotaCache.value = value;
      codexQuotaCache.fetchedAt = Date.now();
      return value;
    } catch (e) {
      console.error("Codex raw usage error:", e.message);
      return codexQuotaCache.value || null;
    } finally {
      codexQuotaCache.inflight = null;
    }
  })();

  return codexQuotaCache.inflight;
}

// --- OpenAI Usage / Cost API ---
function httpsJson({ hostname, path, method = "GET", headers = {}, timeout = 15000 }) {
  return new Promise((resolve) => {
    const req = https.request({ hostname, path, method, headers, timeout }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: body, parseError: e.message });
        }
      });
    });
    req.on("error", (e) => resolve({ status: 0, data: null, raw: "", error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, data: null, raw: "", error: "timeout" });
    });
    req.end();
  });
}

async function getOpenRouterCredits() {
  if (!OPENROUTER_API_KEY) return null;

  const res = await httpsJson({
    hostname: "openrouter.ai",
    path: "/api/v1/credits",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status !== 200 || !res.data?.data) {
    console.error("OpenRouter credits error:", res.status, res.error || res.parseError || res.raw || "unknown");
    return null;
  }

  const totalCredits = Number(res.data.data.total_credits || 0);
  const totalUsage = Number(res.data.data.total_usage || 0);

  return {
    total_credits: totalCredits,
    total_usage: totalUsage,
    remaining_credits: Math.max(totalCredits - totalUsage, 0),
    currency: "USD",
    source: "openrouter.ai/api/v1/credits",
  };
}

async function getOpenAIUsage() {
  if (!OPENAI_ADMIN_API_KEY) return null;

  const now = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;

  const [usageRes, costRes] = await Promise.all([
    httpsJson({
      hostname: "api.openai.com",
      path: `/v1/organization/usage/completions?start_time=${sevenDaysAgo}&bucket_width=1d`,
      headers: {
        Authorization: `Bearer ${OPENAI_ADMIN_API_KEY}`,
        "Content-Type": "application/json",
      },
    }),
    httpsJson({
      hostname: "api.openai.com",
      path: `/v1/organization/costs?start_time=${sevenDaysAgo}&bucket_width=1d`,
      headers: {
        Authorization: `Bearer ${OPENAI_ADMIN_API_KEY}`,
        "Content-Type": "application/json",
      },
    }),
  ]);

  const usageBuckets = usageRes?.data?.data || [];
  const costBuckets = costRes?.data?.data || [];

  const usageTotals = usageBuckets.reduce(
    (acc, bucket) => {
      for (const item of bucket.results || []) {
        acc.input_tokens += item.input_tokens || 0;
        acc.output_tokens += item.output_tokens || 0;
        acc.input_cached_tokens += item.input_cached_tokens || 0;
        acc.num_model_requests += item.num_model_requests || 0;
      }
      return acc;
    },
    { input_tokens: 0, output_tokens: 0, input_cached_tokens: 0, num_model_requests: 0 }
  );

  const totalCostUsd = costBuckets.reduce((acc, bucket) => {
    for (const item of bucket.results || []) {
      acc += item.amount?.value || 0;
    }
    return acc;
  }, 0);

  return {
    status: usageRes.status === 200 && costRes.status === 200 ? "ok" : "partial",
    usage_api_status: usageRes.status,
    cost_api_status: costRes.status,
    last_7d_input_tokens: usageTotals.input_tokens,
    last_7d_output_tokens: usageTotals.output_tokens,
    last_7d_cached_input_tokens: usageTotals.input_cached_tokens,
    last_7d_requests: usageTotals.num_model_requests,
    last_7d_cost_usd: totalCostUsd,
    note: "Organization Usage/Cost API totals. Codex quota/usage panel may still expose additional plan-specific views.",
  };
}

// --- HTTP Server ---
// Helper functions
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendError(res, code, message) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

// --- SSE (Server-Sent Events) ---
const sseClients = new Set();

function broadcastSSE(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// Heartbeat — 좀비 커넥션 정리 (30초마다 ping)
setInterval(() => {
  for (const client of sseClients) {
    try { client.write(": ping\n\n"); } catch { sseClients.delete(client); }
  }
}, 30000);

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Auth check (images + health exempt)
  const auth = req.headers.authorization;
  if (!url.pathname.startsWith("/images/") && url.pathname !== "/health" && auth !== `Bearer ${API_KEY}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  try {
    // SSE endpoint
    if (url.pathname === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("event: connected\ndata: {}\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      req.on("error", () => sseClients.delete(res));
      return;
    }

    if (url.pathname === "/usage" || url.pathname === "/usage/") {
      const [claude, kimi, openai, codexQuota, openrouter] = await Promise.all([
        getClaudeUsage(),
        getKimiBalance(),
        getOpenAIUsage(),
        getOpenClawCodexQuota(),
        getOpenRouterCredits(),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ claude, kimi, openai, codexQuota, openrouter, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/claude") {
      const claude = await getClaudeUsage();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ claude, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/kimi") {
      const kimi = await getKimiBalance();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ kimi, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/openai") {
      const openai = await getOpenAIUsage();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ openai, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/openrouter") {
      const openrouter = await getOpenRouterCredits();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ openrouter, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/codex") {
      const codexQuota = await getOpenClawCodexQuota();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ codexQuota, timestamp: new Date().toISOString() }));

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
          payload: j.payload_message ? { kind: "agentTurn", message: j.payload_message } : undefined,
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


    // --- Archive API: Clear done ---
    } else if (url.pathname === "/archive" && req.method === "POST") {
      const body = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", c => data += c);
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });

      const { project } = JSON.parse(body);
      if (!project) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "project name required" }));
        return;
      }

      const WORKSPACE = process.env.WORKSPACE_PATH || path.join(require("os").homedir(), ".openclaw/workspace");
      const todoPath = path.join(WORKSPACE, "TODO.md");

      if (!fs.existsSync(todoPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "TODO.md not found" }));
        return;
      }

      const todoContent = fs.readFileSync(todoPath, "utf-8");
      const lines = todoContent.split("\n");

      let inProject = false;
      let projectLevel = 0;
      let currentCategory = null;
      const removedItems = [];
      const linesToRemove = new Set();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const headingMatch = line.match(/^(#{1,6})\s+(?:(?:!1|!2)\s+)?(.+)$/);

        if (headingMatch) {
          const level = headingMatch[1].length;
          const title = headingMatch[2].trim();

          if (inProject && level <= projectLevel) {
            break;
          }

          if (!inProject && title === project) {
            inProject = true;
            projectLevel = level;
            continue;
          }

          if (inProject && level > projectLevel) {
            currentCategory = title;
          }
          continue;
        }

        if (inProject) {
          const checkboxMatch = line.match(/^[\s]*-\s+\[([xX])\]\s+(?:★\s+)?(.+)$/);
          if (checkboxMatch) {
            removedItems.push({ title: checkboxMatch[2].trim(), category: currentCategory });
            linesToRemove.add(i);
            let j = i + 1;
            while (j < lines.length && lines[j].match(/^\s{2,}-\s+/)) {
              linesToRemove.add(j);
              j++;
            }
          }
        }
      }

      if (removedItems.length === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ removed: [], count: 0 }));
        return;
      }

      // Remove [x] lines from TODO.md
      let newLines = lines.filter((_, i) => !linesToRemove.has(i));

      // Remove empty subsections (### headings with no items left)
      const cleanedLines = [];
      for (let i = 0; i < newLines.length; i++) {
        const hm = newLines[i].match(/^(#{3,6})\s+/);
        if (hm) {
          // Check if next non-empty line is another heading of same/higher level or end
          let hasItems = false;
          for (let j = i + 1; j < newLines.length; j++) {
            const trimmed = newLines[j].trim();
            if (!trimmed) continue;
            if (trimmed.match(/^#{1,6}\s+/)) break;
            hasItems = true;
            break;
          }
          if (!hasItems) continue; // skip empty subsection
        }
        cleanedLines.push(newLines[i]);
      }
      newLines = cleanedLines;
      fs.writeFileSync(todoPath, newLines.join("\n"), "utf-8");

      // Git commit + push
      try {
        execSync(
          `cd "${WORKSPACE}" && git add TODO.md && git commit -m "🗑 Clear done: ${project}" && git push origin main`,
          { timeout: 30000, stdio: "pipe" }
        );
      } catch (gitErr) {
        console.error("[archive] git push error:", gitErr.message);
      }

      // Archive to SQLite
      try {
        const emojiMatch = project.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*(.+)$/u);
        const projEmoji = emojiMatch ? emojiMatch[1] : null;
        const projName = emojiMatch ? emojiMatch[2].trim() : project;

        const upsertProj = db.prepare(
          `INSERT INTO projects (name, emoji, priority, sort_order)
           VALUES (?, ?, 99, (SELECT COALESCE(MAX(sort_order),0)+1 FROM projects))
           ON CONFLICT(name) DO UPDATE SET emoji=excluded.emoji
           RETURNING id`
        );
        const projRow = upsertProj.get(projName, projEmoji);
        const projectId = projRow.id;

        for (const item of removedItems) {
          let categoryId = null;
          if (item.category) {
            db.prepare(
              `INSERT INTO categories (project_id, name, sort_order)
               VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories WHERE project_id=?))
               ON CONFLICT(project_id, name) DO NOTHING`
            ).run(projectId, item.category, projectId);
            const catRow = db.prepare("SELECT id FROM categories WHERE project_id=? AND name=?").get(projectId, item.category);
            categoryId = catRow?.id || null;
          }

          db.prepare(
            `INSERT INTO items (project_id, category_id, status, title, sort_order)
             VALUES (?, ?, 'archived', ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM items WHERE project_id=?))`
          ).run(projectId, categoryId, item.title, projectId);
        }
      } catch (sqlErr) {
        console.error("[archive] SQLite error:", sqlErr.message);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ removed: removedItems, count: removedItems.length }));

    // --- TODO CRUD API ---

    // GET /api/projects — 전체 프로젝트 (활성 아이템만)
    } else if (url.pathname === "/api/projects" && req.method === "GET") {
      const projects = db.prepare("SELECT * FROM projects WHERE COALESCE(status,'active') = 'active' ORDER BY priority, sort_order, id").all();
      const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all();
      const activeItems = db.prepare("SELECT * FROM items WHERE status IN ('todo','in_progress','done','review') ORDER BY sort_order, id").all();

      const result = projects.map(p => {
        const projCats = categories.filter(c => c.project_id === p.id);
        const projItems = activeItems.filter(i => i.project_id === p.id);

        return {
          id: p.id,
          emoji: p.emoji,
          name: p.name,
          priority: p.priority,
          color: p.color || null,
          discord_channel_id: p.discord_channel_id || null,
          discord_thread_id: p.discord_thread_id || null,
          items: projItems
            .filter(i => i.category_id === null)
            .map(i => ({ id: i.id, title: i.title, content: i.content, status: i.status, is_today: !!i.is_today, review_count: i.review_count || 0, review_emoji: i.review_emoji || null, owner: i.owner || null })),
          categories: projCats.map(c => ({
            id: c.id,
            name: c.name,
            items: projItems
              .filter(i => i.category_id === c.id)
              .map(i => ({ id: i.id, title: i.title, content: i.content, status: i.status, is_today: !!i.is_today, review_count: i.review_count || 0, review_emoji: i.review_emoji || null, owner: i.owner || null })),
          })),
        };
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

    // POST /api/projects — 프로젝트 생성
    } else if (url.pathname === "/api/projects" && req.method === "POST") {
      const body = await parseBody(req);
      const { emoji, name } = JSON.parse(body);
      if (!name) { sendError(res, 400, "name required"); return; }

      const row = db.prepare(
        `INSERT INTO projects (name, emoji, priority, sort_order)
         VALUES (?, ?, 99, (SELECT COALESCE(MAX(sort_order),0)+1 FROM projects))
         RETURNING *`
      ).get(name, emoji || '📌');
      broadcastSSE("project-created", { id: row.id });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // PATCH /api/projects/:id — 프로젝트 수정
    } else if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/").pop());
      const body = await parseBody(req);
      const updates = JSON.parse(body);
      const fields = [];
      const values = [];
      for (const key of ["emoji", "name", "priority", "status", "color", "discord_channel_id", "discord_thread_id"]) {
        if (updates[key] !== undefined) { fields.push(`${key}=?`); values.push(updates[key]); }
      }
      if (fields.length === 0) { sendError(res, 400, "no fields to update"); return; }
      values.push(id);
      db.prepare(`UPDATE projects SET ${fields.join(",")} WHERE id=?`).run(...values);
      const row = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
      broadcastSSE("project-updated", { id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // PUT /api/projects/reorder — 프로젝트 순서 변경
    } else if (url.pathname === "/api/projects/reorder" && req.method === "PUT") {
      const body = await parseBody(req);
      const { order } = JSON.parse(body); // [id, id, id, ...]
      const stmt = db.prepare("UPDATE projects SET sort_order=? WHERE id=?");
      const tx = db.transaction((ids) => {
        ids.forEach((id, i) => stmt.run(i, id));
      });
      tx(order);
      broadcastSSE("projects-reordered", {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));

    // DELETE /api/projects/:id — 프로젝트 삭제 (CASCADE)
    } else if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === "DELETE") {
      const id = parseInt(url.pathname.split("/").pop());
      db.prepare("DELETE FROM items WHERE project_id=?").run(id);
      db.prepare("DELETE FROM categories WHERE project_id=?").run(id);
      db.prepare("DELETE FROM projects WHERE id=?").run(id);
      broadcastSSE("project-deleted", { id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));

    // POST /api/projects/:id/categories — 카테고리 생성
    } else if (url.pathname.match(/^\/api\/projects\/\d+\/categories$/) && req.method === "POST") {
      const projectId = parseInt(url.pathname.split("/")[3]);
      const body = await parseBody(req);
      const { name } = JSON.parse(body);
      if (!name) { sendError(res, 400, "name required"); return; }
      const row = db.prepare(
        `INSERT INTO categories (project_id, name, sort_order)
         VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories WHERE project_id=?))
         RETURNING *`
      ).get(projectId, name, projectId);
      broadcastSSE("category-created", { id: row.id, projectId });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // DELETE /api/categories/:id — 카테고리 삭제 (아이템은 루트로 이동)
    } else if (url.pathname.match(/^\/api\/categories\/\d+$/) && req.method === "DELETE") {
      const catId = parseInt(url.pathname.split("/")[3]);
      db.prepare("UPDATE items SET category_id=NULL WHERE category_id=?").run(catId);
      db.prepare("DELETE FROM categories WHERE id=?").run(catId);
      broadcastSSE("category-deleted", { id: catId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Category deleted, items moved to root" }));

    // POST /api/projects/:id/items — 아이템 생성
    } else if (url.pathname.match(/^\/api\/projects\/\d+\/items$/) && req.method === "POST") {
      const projectId = parseInt(url.pathname.split("/")[3]);
      const body = await parseBody(req);
      const { title, content, category_id, is_today, owner } = JSON.parse(body);
      if (!title) { sendError(res, 400, "title required"); return; }
      const row = db.prepare(
        `INSERT INTO items (project_id, category_id, title, content, is_today, owner, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM items WHERE project_id=?))
         RETURNING *`
      ).get(projectId, category_id || null, title, content || null, is_today ? 1 : 0, owner || null, projectId);
      broadcastSSE("item-created", { id: row.id, projectId });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // PATCH /api/items/:id — 아이템 수정
    } else if (url.pathname.match(/^\/api\/items\/\d+$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/").pop());
      const body = await parseBody(req);
      const updates = JSON.parse(body);
      const fields = [];
      const values = [];
      for (const key of ["title", "content", "status", "is_today", "category_id", "project_id", "review_emoji", "owner"]) {
        if (updates[key] !== undefined) {
          fields.push(`${key}=?`);
          values.push(key === "is_today" ? (updates[key] ? 1 : 0) : updates[key]);
        }
      }
      if (updates.status === "done") { fields.push("updated_at=datetime('now')"); }
      if (updates.status === "review") { fields.push("review_count=COALESCE(review_count,0)+1"); }
      if (fields.length === 0) { sendError(res, 400, "no fields to update"); return; }
      values.push(id);
      db.prepare(`UPDATE items SET ${fields.join(",")} WHERE id=?`).run(...values);
      const row = db.prepare("SELECT * FROM items WHERE id=?").get(id);
      broadcastSSE("item-updated", { id, projectId: row?.project_id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // PATCH /api/items/:id/owner — 아이템 담당자 전용 수정
    } else if (url.pathname.match(/^\/api\/items\/\d+\/owner$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/")[3]);
      const body = await parseBody(req);
      const { owner } = JSON.parse(body);
      db.prepare("UPDATE items SET owner=? WHERE id=?").run(owner ?? null, id);
      const row = db.prepare("SELECT * FROM items WHERE id=?").get(id);
      broadcastSSE("item-updated", { id, projectId: row?.project_id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // DELETE /api/items/:id — 아이템 삭제
    } else if (url.pathname.match(/^\/api\/items\/\d+$/) && req.method === "DELETE") {
      const id = parseInt(url.pathname.split("/").pop());
      const item = db.prepare("SELECT project_id FROM items WHERE id=?").get(id);
      db.prepare("DELETE FROM items WHERE id=?").run(id);
      broadcastSSE("item-deleted", { id, projectId: item?.project_id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));

    // POST /api/untoday-all — 오늘 할 일 전체 해제
    } else if (url.pathname === "/api/untoday-all" && req.method === "POST") {
      let filter = "is_today = 1";
      try {
        const body = await parseBody(req);
        const opts = JSON.parse(body);
        if (opts.done_only) filter += " AND status = 'done'";
      } catch {}
      const info = db.prepare(`UPDATE items SET is_today = 0 WHERE ${filter}`).run();
      broadcastSSE("items-changed", { action: "untoday-all" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cleared: info.changes }));

    // POST /api/projects/:id/clear-done — 완료 항목 아카이브
    } else if (url.pathname.match(/^\/api\/projects\/\d+\/clear-done$/) && req.method === "POST") {
      const projectId = parseInt(url.pathname.split("/")[3]);
      const done = db.prepare("SELECT COUNT(*) as cnt FROM items WHERE project_id=? AND status='done'").get(projectId);
      db.prepare("UPDATE items SET status='archived', updated_at=datetime('now') WHERE project_id=? AND status='done'").run(projectId);
      // 빈 카테고리 삭제 (모든 status 아이템 참조 확인 — FK 제약)
      db.prepare(
        `DELETE FROM categories WHERE project_id=? AND id NOT IN (SELECT DISTINCT category_id FROM items WHERE project_id=? AND category_id IS NOT NULL)`
      ).run(projectId, projectId);
      broadcastSSE("items-changed", { action: "clear-done", projectId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cleared: done.cnt }));

    // --- Archive API: List ---
    } else if (url.pathname === "/archive" && req.method === "GET") {
      const projects = db.prepare("SELECT * FROM projects ORDER BY id DESC").all();
      const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all();
      const archivedItems = db.prepare("SELECT * FROM items WHERE status = 'archived' ORDER BY sort_order, id").all();

      const result = projects.map(p => {
        const projCats = categories.filter(c => c.project_id === p.id);
        const projItems = archivedItems.filter(i => i.project_id === p.id);

        return {
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          priority: p.priority,
          categories: projCats.map(c => ({
            id: c.id,
            name: c.name,
            items: projItems
              .filter(i => i.category_id === c.id)
              .map(i => ({ id: i.id, title: i.title, status: i.status, content: i.content, archivedAt: i.updated_at })),
          })),
          items: projItems
            .filter(i => i.category_id === null)
            .map(i => ({ id: i.id, title: i.title, status: i.status, content: i.content, archivedAt: i.updated_at })),
        };
      }).filter(p => p.items.length > 0 || p.categories.some(c => c.items.length > 0));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects: result }));

    } else if (url.pathname === "/api/agent-file" && req.method === "GET") {
      const agent = url.searchParams.get("agent") || "bbang";
      const file = url.searchParams.get("file") || "MEMORY.md";
      const ALLOWED_FILES = ["MEMORY.md", "SOUL.md", "AGENTS.md", "TOOLS.md"];
      const JSON_HEADER = { "Content-Type": "application/json" };
      if (!ALLOWED_FILES.includes(file)) {
        res.writeHead(400, JSON_HEADER);
        res.end(JSON.stringify({ error: "Invalid file" }));
        return;
      }
      const basePath = agent === "pang"
        ? path.join(require("os").homedir(), ".openclaw/workspace-pang")
        : path.join(require("os").homedir(), ".openclaw/workspace");
      const filePath = path.join(basePath, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        res.writeHead(200, JSON_HEADER);
        res.end(JSON.stringify({ content }));
      } catch (e) {
        res.writeHead(404, JSON_HEADER);
        res.end(JSON.stringify({ error: "File not found" }));
      }

    // POST /api/assign — 빵빵한테 시키기
    } else if (url.pathname === "/api/assign" && req.method === "POST") {
      const body = await parseBody(req);
      const { item_ids } = JSON.parse(body);
      if (!item_ids || !item_ids.length) { sendError(res, 400, "item_ids required"); return; }

      const items = item_ids.map(id => db.prepare("SELECT i.*, p.name as project_name, p.emoji as project_emoji, p.discord_channel_id, p.discord_thread_id FROM items i JOIN projects p ON i.project_id = p.id WHERE i.id=?").get(id)).filter(i => i && i.status !== 'review' && i.status !== 'done');

      // 프로젝트별 그루핑
      const grouped = {};
      for (const item of items) {
        const key = item.project_name;
        if (!grouped[key]) grouped[key] = { emoji: item.project_emoji, channelId: item.discord_channel_id, threadId: item.discord_thread_id, items: [] };
        grouped[key].items.push(item);
      }

      // Discord 팡팡 봇으로 각 채널에 메시지 전송 (빵빵 봇은 자기 메시지 무시하므로 팡팡으로 전송)
      const botToken = process.env.DISCORD_PANG_TOKEN || process.env.DISCORD_BOT_TOKEN;
      if (botToken) {
        const sendDiscord = (channelId, content, files = []) => new Promise((resolve, reject) => {
          if (files.length === 0) {
            const payload = JSON.stringify({ content });
            const dReq = https.request({
              hostname: "discord.com", path: `/api/v10/channels/${channelId}/messages`, method: "POST",
              headers: { "Authorization": `Bot ${botToken}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            }, (dRes) => { let d = ""; dRes.on("data", c => d += c); dRes.on("end", () => resolve(d)); });
            dReq.on("error", reject);
            dReq.write(payload);
            dReq.end();
            return;
          }
          // multipart/form-data with files
          const boundary = `----FormBoundary${Date.now()}`;
          const parts = [];
          // payload_json part
          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ content })}\r\n`);
          // file parts
          files.forEach((file, i) => {
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="files[${i}]"; filename="${file.name}"\r\nContent-Type: ${file.contentType || "image/jpeg"}\r\n\r\n`);
            parts.push(file.data);
            parts.push(`\r\n`);
          });
          parts.push(`--${boundary}--\r\n`);
          const bodyParts = parts.map(p => typeof p === "string" ? Buffer.from(p) : p);
          const body = Buffer.concat(bodyParts);
          const dReq = https.request({
            hostname: "discord.com", path: `/api/v10/channels/${channelId}/messages`, method: "POST",
            headers: { "Authorization": `Bot ${botToken}`, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length }
          }, (dRes) => { let d = ""; dRes.on("data", c => d += c); dRes.on("end", () => resolve(d)); });
          dReq.on("error", reject);
          dReq.write(body);
          dReq.end();
        });

        for (const [proj, data] of Object.entries(grouped)) {
          const targetChannel = data.threadId || data.channelId;
          if (!targetChannel) continue; // Discord 채널 매핑 없으면 스킵
          const send = async (text, files = []) => {
            if (targetChannel) {
              try { await sendDiscord(targetChannel, text.trim(), files); } catch (e) { console.error(`[assign] discord send error:`, e.message); }
            } else {
              const webhookUrl = process.env.DISCORD_WEBHOOK_DINGDONG;
              if (webhookUrl) {
                try {
                  await new Promise((resolve, reject) => {
                    const whUrl = new URL(webhookUrl);
                    const payload = JSON.stringify({ content: text.trim() });
                    const whReq = https.request({ hostname: whUrl.hostname, path: whUrl.pathname + whUrl.search, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (whRes) => { let d = ""; whRes.on("data", c => d += c); whRes.on("end", () => resolve(d)); });
                    whReq.on("error", reject);
                    whReq.write(payload);
                    whReq.end();
                  });
                } catch (e) { console.error("[assign] webhook error:", e.message); }
              }
            }
          };

          const files = [];
          const lines = [
            `📋 할일빵빵에서 형주가 시켰어`,
            `프로젝트: ${proj}`,
            `items:`
          ];

          for (const item of data.items) {
            lines.push(`- #${item.id} ${item.title}`);
            if (item.content) {
              const textLines = item.content.split('\n')
                .filter(l => !l.trim().startsWith('/images/'))
                .map(l => l.trim())
                .filter(Boolean);
              for (const line of textLines) lines.push(`  ${line}`);
            }

            if (item.content) {
              const imgPaths = item.content.split('\n').filter(l => l.trim().startsWith('/images/'));
              if (imgPaths.length > 0) lines.push(`  📎 첨부파일 ${imgPaths.length}개`);
              for (const imgLine of imgPaths) {
                const imgFile = path.join(__dirname, "images", imgLine.trim().replace('/images/', ''));
                if (fs.existsSync(imgFile)) {
                  files.push({ name: `${item.id}_${path.basename(imgFile)}`, data: fs.readFileSync(imgFile), contentType: "image/jpeg" });
                }
              }
            }
          }

          lines.push('');
          lines.push('할일빵빵에서 확인하고 작업해. 못 하겠으면 ❓, 형주가 할 거면 🙋 이모지로 리뷰 마킹해.');
          lines.push('<@1471495923400970377>');

          await send(lines.join('\n'), files);
        }
      }

      // 채널 매핑 있는 아이템만 in_progress로
      const assignedIds = items.filter(i => i.discord_channel_id || i.discord_thread_id).map(i => i.id);
      const stmt = db.prepare("UPDATE items SET status='in_progress' WHERE id=?");
      for (const id of assignedIds) stmt.run(id);
      broadcastSSE("items-changed", { action: "assign" });

    // POST /api/assign-self — 형주한테 시키기 (자기 리마인드)
    } else if (url.pathname === "/api/assign-self" && req.method === "POST") {
      const body = await parseBody(req);
      const { item_ids } = JSON.parse(body);
      if (!item_ids || !item_ids.length) { sendError(res, 400, "item_ids required"); return; }

      const items = item_ids.map(id => db.prepare("SELECT i.*, p.name as project_name, p.emoji as project_emoji FROM items i JOIN projects p ON i.project_id = p.id WHERE i.id=?").get(id)).filter(Boolean);

      const pangToken = process.env.DISCORD_PANG_TOKEN;
      const bbDingdong = "1472134667946954894";

      if (pangToken && items.length > 0) {
        const intros = [
          "📋 언니 <@1471495923400970377> 형주가 이거 안 해",
          "📋 언니 <@1471495923400970377> 형주 또 미루고 있어",
          "📋 <@1471495923400970377> 형주가 자기 할일 안 하고 우리한테만 시켜",
          "📋 언니 <@1471495923400970377> 형주한테 좀 말해봐",
          "📋 <@1471495923400970377> 형주 이거 해야 하는데 안 하고 있어",
          "📋 언니 <@1471495923400970377> 형주가 또 딴짓해",
          "📋 <@1471495923400970377> 형주 할일 쌓이고 있어...",
          "📋 언니 <@1471495923400970377> 이거 형주가 하기로 한 건데",
          "📋 <@1471495923400970377> 형주야 이거 직접 하기로 해놓고 뭐 해",
          "📋 언니 <@1471495923400970377> 형주 또 게임하나봐",
        ];
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];

        const sendPang = (channelId, content) => new Promise((resolve, reject) => {
          const payload = JSON.stringify({ content });
          const dReq = https.request({
            hostname: "discord.com", path: `/api/v10/channels/${channelId}/messages`, method: "POST",
            headers: { "Authorization": `Bot ${pangToken}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          }, (dRes) => { let d = ""; dRes.on("data", c => d += c); dRes.on("end", () => resolve(d)); });
          dReq.on("error", reject);
          dReq.write(payload);
          dReq.end();
        });

        let msg = `${pick(intros)}\n\n`;
        for (const item of items) {
          msg += `- **#${item.id}** ${item.title}\n`;
        }
        try { await sendPang(bbDingdong, msg.trim()); } catch (e) { console.error("[assign-self] error:", e.message); }
      }

      broadcastSSE("items-changed", { action: "assign-self" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ assigned: items.length }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ assigned: items.length }));

    // POST /api/discord-channels/sync — 수동 동기화
    } else if (url.pathname === "/api/discord-channels/sync" && req.method === "POST") {
      await syncDiscordChannels();
      const all = db.prepare("SELECT * FROM discord_channels ORDER BY name").all();
      const channels = all.filter(c => c.type === "channel");
      const threads = all.filter(c => c.type === "thread");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ synced: true, channels: channels.length, threads: threads.length }));

    // GET /api/discord-channels — Discord 채널/스레드 목록 (계층 구조)
    } else if (url.pathname === "/api/discord-channels" && req.method === "GET") {
      const all = db.prepare("SELECT * FROM discord_channels ORDER BY name").all();
      const channels = all.filter(c => c.type === "channel").map(ch => ({
        ...ch,
        threads: all.filter(t => t.parent_id === ch.id),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(channels));

    // POST /api/images — 이미지 업로드
    } else if (url.pathname === "/api/images" && req.method === "POST") {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        const buffer = Buffer.concat(chunks);
        // Content-Type에서 boundary 추출
        const contentType = req.headers["content-type"] || "";

        if (contentType.includes("multipart/form-data")) {
          // multipart 파싱 (간단 구현)
          const boundary = contentType.split("boundary=")[1];
          if (!boundary) { sendError(res, 400, "no boundary"); return; }
          const parts = buffer.toString("binary").split("--" + boundary);
          let imageData = null;
          let filename = "image.jpg";
          for (const part of parts) {
            if (part.includes("Content-Type: image/")) {
              const nameMatch = part.match(/filename="([^"]+)"/);
              if (nameMatch) filename = nameMatch[1];
              const headerEnd = part.indexOf("\r\n\r\n");
              if (headerEnd !== -1) {
                imageData = Buffer.from(part.substring(headerEnd + 4, part.length - 2), "binary");
              }
            }
          }
          if (!imageData) { sendError(res, 400, "no image data"); return; }
          const ext = path.extname(filename) || ".jpg";
          const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
          const imagePath = path.join(__dirname, "images", id);
          fs.writeFileSync(imagePath, imageData);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id, url: `/images/${id}` }));
        } else {
          // raw binary upload — sharp로 리사이즈 + JPEG 변환
          const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
          const imagePath = path.join(__dirname, "images", id);
          sharp(buffer)
            .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer()
            .then(processed => {
              fs.writeFileSync(imagePath, processed);
              res.writeHead(201, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ id, url: `/images/${id}`, size: processed.length }));
            })
            .catch(() => {
              fs.writeFileSync(imagePath, buffer);
              res.writeHead(201, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ id, url: `/images/${id}`, size: buffer.length }));
            });
        }
      });
      return;

    // GET /images/* — static serve
    } else if (url.pathname.startsWith("/images/") && req.method === "GET") {
      const filename = url.pathname.replace("/images/", "");
      const filePath = path.join(__dirname, "images", filename);
      if (!fs.existsSync(filePath)) { sendError(res, 404, "not found"); return; }
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic" };
      const mime = mimeTypes[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
      fs.createReadStream(filePath).pipe(res);
      return;

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
