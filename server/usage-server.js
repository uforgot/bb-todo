#!/usr/bin/env node
/**
 * Local Usage API Server
 * Exposes Claude (macOS plist) + Kimi (Moonshot API) usage data + Cron status (SQLite)
 * Designed to run behind Tailscale Funnel
 */

const path = require("path");
const os = require("os");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(os.homedir(), ".openclaw/.env") });

const http = require("http");
const { execFile, execSync } = require("child_process");
const https = require("https");
const plist = require("simple-plist");
const fs = require("fs");
const crypto = require("crypto");
const zlib = require("zlib");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const Database = require("better-sqlite3");
const sharp = require("sharp");
const { scanDependencies } = require("./dependency-scanner");
const { createMeetingSummaryGenerator } = require("./meeting-summary");
const {
  migrateMeetingSummaryJobsSchema,
  createMeetingSummaryJobService,
} = require("./meeting-summary-jobs");
const { createSillokSummaryDispatcher } = require("./sillok-summary-dispatcher");
const { createSillokSummaryReconciler } = require("./sillok-summary-reconciler");
const {
  normalizeLocation,
  resolveLocationLabel,
  buildTimeLabel,
  readWeatherSnapshot,
} = require("./recording-context");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createTodayQueueService } = require("./today-queue-service");
const { migrateTodayQueueHistorySchema } = require("./today-queue-history-schema");
const { createTodayQueueHistoryService } = require("./today-queue-history-service");
const { createTodayQueueRunLifecycle } = require("./today-queue-run-lifecycle");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createTodayQueueResultHandler } = require("./today-queue-result-handler");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateGitCommitDeclaration } = require("./today-queue-policy");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildBoundedDiscordPrompt } = require("./today-queue-prompt");

const PORT = process.env.USAGE_PORT || 3100;
const API_KEY = process.env.USAGE_API_KEY;
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY;
const ANTHROPIC_ADMIN_API_KEY = process.env.ANTHROPIC_ADMIN_API_KEY;
const OPENAI_ADMIN_API_KEY = process.env.OPENAI_ADMIN_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const XAI_MANAGEMENT_API_KEY = process.env.XAI_MANAGEMENT_API_KEY;
const XAI_TEAM_ID = process.env.XAI_TEAM_ID;
const CRON_JOBS_PATH = process.env.CRON_JOBS_PATH || path.join(os.homedir(), ".openclaw/cron/jobs.json");
const CRON_POLL_INTERVAL = parseInt(process.env.CRON_POLL_INTERVAL || "300000"); // 5 min
const DB_PATH = process.env.CRON_DB_PATH || path.join(__dirname, "cron.db");
const KUKU_SUPABASE_URL = stripTrailingSlash(process.env.KUKU_SUPABASE_URL || process.env.DF_REVIEW_SUPABASE_URL || process.env.SUPABASE_URL || "");
const KUKU_SUPABASE_KEY = process.env.KUKU_SUPABASE_SERVICE_ROLE_KEY || process.env.KUKU_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const REVIEW_FIGMA_IMAGES_TABLE = process.env.REVIEW_FIGMA_IMAGES_TABLE || process.env.KUKU_REVIEW_FIGMA_IMAGES_TABLE || "review_figma_images";
const REVIEW_FIGMA_IMAGES_SOURCE = process.env.REVIEW_FIGMA_IMAGES_SOURCE || process.env.KUKU_DEFAULT_SOURCE || "supabase";
const REVIEW_FIGMA_IMAGES_PUBLIC_PATH = normalizePublicPath(process.env.REVIEW_FIGMA_IMAGES_PUBLIC_PATH || "/review-figma-images");
const REVIEW_FIGMA_IMAGES_DIR = process.env.REVIEW_FIGMA_IMAGES_DIR || path.join(__dirname, "images", "review-figma");
const REVIEW_ATTACHMENTS_PUBLIC_PATH = normalizePublicPath(process.env.REVIEW_ATTACHMENTS_PUBLIC_PATH || "/review-attachments");
const REVIEW_ATTACHMENTS_DIR = process.env.REVIEW_ATTACHMENTS_DIR || path.join(__dirname, "images", "review-attachments");
const REVIEW_ATTACHMENTS_MAX_BYTES = parseInt(process.env.REVIEW_ATTACHMENTS_MAX_BYTES || String(20 * 1024 * 1024), 10);
const MEETING_ARCHIVE_DIR = process.env.MEETING_ARCHIVE_DIR || path.join(os.homedir(), "Documents", "MeetingArchive");
const MEETING_UPLOAD_MAX_BYTES = parseInt(process.env.MEETING_UPLOAD_MAX_BYTES || String(512 * 1024 * 1024), 10);
const MEETING_AGENT_SUMMARY_ENABLED = /^true$/i.test(process.env.MEETING_AGENT_SUMMARY_ENABLED || "");
const SILLOK_SUMMARY_DISPATCH_ENABLED = MEETING_AGENT_SUMMARY_ENABLED
  && !/^false$/i.test(process.env.SILLOK_SUMMARY_DISPATCH_ENABLED || "");
const SILLOK_SUMMARY_DISPATCH_CHANNEL_ID = process.env.SILLOK_SUMMARY_DISPATCH_CHANNEL_ID || "1475129999991509094";
const SILLOK_SUMMARY_DISPATCH_POLL_MS = parseInt(process.env.SILLOK_SUMMARY_DISPATCH_POLL_MS || "15000", 10);
const SILLOK_SUMMARY_DISPATCH_TIMEOUT_MS = parseInt(process.env.SILLOK_SUMMARY_DISPATCH_TIMEOUT_MS || "10000", 10);
const SILLOK_SUMMARY_DISPATCH_RETRY_MS = parseInt(process.env.SILLOK_SUMMARY_DISPATCH_RETRY_MS || "30000", 10);
const SILLOK_SUMMARY_RECONCILE_MS = parseInt(process.env.SILLOK_SUMMARY_RECONCILE_MS || "15000", 10);
const SILLOK_SUMMARY_DISPATCH_STALE_MS = parseInt(process.env.SILLOK_SUMMARY_DISPATCH_STALE_MS || "20000", 10);
const SILLOK_SUMMARY_ACK_TIMEOUT_MS = parseInt(process.env.SILLOK_SUMMARY_ACK_TIMEOUT_MS || "120000", 10);
const SILLOK_SUMMARY_MAX_ATTEMPTS = parseInt(process.env.SILLOK_SUMMARY_MAX_ATTEMPTS || "5", 10);
const VOICE_CONFIG_PATH = path.join(__dirname, "voice-config.json");
const DEFAULT_TODO_QUEUE_BOT_KEY = process.env.TODO_QUEUE_BOT_KEY || "bbangbbang";
const DEFAULT_TODO_QUEUE_BOT_USER_ID = process.env.TODO_QUEUE_BOT_USER_ID || process.env.BBANGBBANG_USER_ID || "1471495923400970377";
const TODAY_QUEUE_BRIDGE_ENABLED = !/^false$/i.test(process.env.TODAY_QUEUE_BRIDGE_ENABLED || "");
const TODAY_QUEUE_BRIDGE_TOKEN = process.env.DISCORD_TODAY_QUEUE_BRIDGE_TOKEN || process.env.DISCORD_VOICE_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || "";
// Send queue task packets as the queue/listener bot, not as the selected worker AI.
// The selected project AI stays the mention/marker author target.
const TODAY_QUEUE_DISPATCH_TOKEN = process.env.DISCORD_TODAY_QUEUE_DISPATCH_TOKEN || TODAY_QUEUE_BRIDGE_TOKEN || process.env.DISCORD_PANG_TOKEN || "";
const SILLOK_SUMMARY_DISPATCH_TOKEN = process.env.DISCORD_SILLOK_SUMMARY_TOKEN || TODAY_QUEUE_DISPATCH_TOKEN;

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
    status TEXT DEFAULT 'active',
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

  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    record_number INTEGER,
    recorded_at TEXT NOT NULL,
    recorded_date TEXT NOT NULL,
    title TEXT,
    transcript TEXT,
    speaker_names_json TEXT,
    audio_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_seconds REAL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_meetings_recorded_at ON meetings(recorded_at DESC);
`);

// Migration: meeting transcription jobs
try { db.exec("ALTER TABLE meetings ADD COLUMN record_number INTEGER"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_status TEXT DEFAULT 'idle'"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_attempts INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_error TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_model TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_id TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_language TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_language_probability REAL"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_duration_seconds REAL"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_words_json TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_segments_json TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_options_json TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN transcription_updated_at TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN speaker_names_json TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN audio_deleted_at TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN summary TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN title_source TEXT DEFAULT 'default'"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN summary_status TEXT DEFAULT 'idle'"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN summary_model TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN summary_error TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN summary_updated_at TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN location_lat REAL"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN location_lng REAL"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN location_accuracy REAL"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN location_timestamp TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN location_label TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN time_label TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN weather_label TEXT"); } catch {}
try { db.exec("ALTER TABLE meetings ADD COLUMN weather_observed_at TEXT"); } catch {}
try {
  db.exec(`
    UPDATE meetings
       SET title_source=CASE
         WHEN title IS NOT NULL AND trim(title)<>'' THEN 'user'
         ELSE 'default'
       END
     WHERE title_source IS NULL OR title_source NOT IN ('default','ai','user');
    UPDATE meetings
       SET summary_status='failed',
           summary_error='서버 재시작으로 요약 작업이 중단됐어.',
           summary_updated_at=datetime('now')
     WHERE summary_status IN ('queued','processing');
  `);
} catch {}
migrateMeetingSummaryJobsSchema(db);
try {
  const missingRecordNumbers = db.prepare(`
    SELECT id FROM meetings
     WHERE record_number IS NULL
     ORDER BY recorded_at ASC, created_at ASC, id ASC
  `).all();
  const firstRecordNumber = db.prepare("SELECT COALESCE(MAX(record_number), 0) + 1 AS value FROM meetings").get().value;
  const assignRecordNumbers = db.transaction(rows => {
    const update = db.prepare("UPDATE meetings SET record_number=? WHERE id=?");
    rows.forEach((row, index) => update.run(firstRecordNumber + index, row.id));
  });
  assignRecordNumbers(missingRecordNumbers);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_record_number ON meetings(record_number)");
  db.exec(`
    UPDATE meetings
       SET transcription_status='failed',
           transcription_error='서버 재시작으로 전사 작업이 중단됐어. 다시 처리가 필요해.',
           transcription_updated_at=datetime('now')
     WHERE transcription_status IN ('queued','processing');
  `);
} catch {}

// Migration: review_count
try { db.exec("ALTER TABLE items ADD COLUMN review_count INTEGER DEFAULT 0"); } catch {}
// Migration: is_today
try { db.exec("ALTER TABLE items ADD COLUMN is_today INTEGER DEFAULT 0"); } catch {}
// Migration: review_emoji
try { db.exec("ALTER TABLE items ADD COLUMN review_emoji TEXT"); } catch {}
// Migration: owner
try { db.exec("ALTER TABLE items ADD COLUMN owner TEXT"); } catch {}
// Migration: owner 빵빵/기타 봇 → AI 통일 (owner 모델은 AI / hyungju 둘로 단순화)
try { db.exec("UPDATE items SET owner='AI' WHERE owner IS NOT NULL AND owner NOT IN ('hyungju','AI')"); } catch {}
// Migration: Today Task Queue ordering + dispatch metadata
try { db.exec("ALTER TABLE items ADD COLUMN today_queue_order INTEGER"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_nonce TEXT"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_message_id TEXT"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_channel_id TEXT"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_message_url TEXT"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_target_bot_key TEXT"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_target_bot_user_id TEXT"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_started_at TEXT"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_attempt_count INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE items ADD COLUMN dispatch_last_error TEXT"); } catch {}
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_today_ai_queue ON items(is_today, owner, status, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_items_today_ai_queue_order ON items(project_id, is_today, owner, status, today_queue_order, id);
    CREATE INDEX IF NOT EXISTS idx_items_dispatch_nonce ON items(dispatch_nonce);
  `);
} catch {}
// Migration: project lifecycle + discord channel mapping + project-level AI assignee
try { db.exec("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active'"); } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN discord_channel_id TEXT"); } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN discord_thread_id TEXT"); } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN default_ai_bot_key TEXT DEFAULT 'bbangbbang'"); } catch {}
try { db.exec("UPDATE projects SET default_ai_bot_key='bbangbbang' WHERE default_ai_bot_key IS NULL OR trim(default_ai_bot_key)=''"); } catch {}
// Migration: forward-only Today Queue run history. Existing dispatch metadata is not backfilled.
migrateTodayQueueHistorySchema(db);
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
    // Remove jobs from DB that are no longer in jobs.json
    const currentIds = jobs.map(j => j.id).filter(Boolean);
    if (currentIds.length > 0) {
      const placeholders = currentIds.map(() => "?").join(",");
      const removed = db.prepare(`DELETE FROM cron_jobs WHERE job_id NOT IN (${placeholders})`).run(...currentIds);
      if (removed.changes > 0) {
        console.log(`[cron-poll] ${removed.changes} stale job(s) removed from DB`);
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

let grokUsageCache = {
  value: null,
  fetchedAt: 0,
  inflight: null,
};

function execFileJson(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(new Error(`Invalid JSON from ${command}: ${parseError.message}`));
      }
    });
  });
}

async function getGrokSubscriptionUsage(forceRefresh = false) {
  const now = Date.now();
  const cacheAge = now - grokUsageCache.fetchedAt;
  if (!forceRefresh && grokUsageCache.value && cacheAge < 5 * 60 * 1000) {
    return grokUsageCache.value;
  }
  if (grokUsageCache.inflight) return grokUsageCache.inflight;

  grokUsageCache.inflight = (async () => {
    try {
      const codexbar = process.env.CODEXBAR_BIN || "/opt/homebrew/bin/codexbar";
      const result = await execFileJson(
        codexbar,
        ["usage", "--provider", "grok", "--format", "json", "--source", "auto"],
        { timeout: 30000, maxBuffer: 1024 * 1024 }
      );
      const entry = Array.isArray(result) ? result.find((item) => item?.provider === "grok") : null;
      const usage = entry?.usage;
      const primary = usage?.primary;
      if (!primary || !Number.isFinite(primary.usedPercent)) {
        throw new Error("Grok subscription quota is missing from CodexBar output");
      }

      const usedPercent = Math.max(0, Math.min(100, Number(primary.usedPercent)));
      const value = {
        provider: "grok",
        plan: usage.loginMethod || usage.identity?.loginMethod || "SuperGrok",
        used_percent: usedPercent,
        left_percent: Math.max(0, 100 - usedPercent),
        reset_at: primary.resetsAt || null,
        source: entry.source || "grok-web",
      };
      grokUsageCache.value = value;
      grokUsageCache.fetchedAt = Date.now();
      return value;
    } catch (error) {
      console.error("Grok subscription usage error:", error.message);
      return grokUsageCache.value || null;
    } finally {
      grokUsageCache.inflight = null;
    }
  })();

  return grokUsageCache.inflight;
}

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

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    if (e?.code !== "ENOENT") {
      console.error(`JSON read error (${filePath}):`, e.message);
    }
    return null;
  }
}

function getCodexAuthProfile() {
  try {
    const os = require("os");
    const home = os.homedir();
    const authProfilesPath = path.join(home, ".openclaw/agents/main/agent/auth-profiles.json");
    const codexAuthPath = path.join(home, ".codex/auth.json");

    const parseAccessToken = (access) => {
      if (!access) return null;
      const tokenPayload = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString("utf8"));
      return {
        accountId: tokenPayload?.["https://api.openai.com/auth"]?.chatgpt_account_id,
        email: tokenPayload?.["https://api.openai.com/profile"]?.email || null,
      };
    };

    const authProfiles = safeReadJson(authProfilesPath);
    if (authProfiles) {
      const profiles = authProfiles?.profiles || {};
      const preferred = authProfiles?.lastGood?.["openai-codex"];
      const profile = (preferred && profiles[preferred]) || profiles["openai-codex:default"] || Object.values(profiles).find((entry) => entry?.provider === "openai-codex");
      if (profile?.access) {
        const token = parseAccessToken(profile.access);
        return {
          access: profile.access,
          accountId: profile.accountId || token?.accountId || undefined,
          email: profile.email || token?.email || null,
          source: authProfilesPath,
        };
      }
    }

    const codexAuth = safeReadJson(codexAuthPath);
    const codexAccess = codexAuth?.tokens?.access_token;
    if (codexAccess) {
      const token = parseAccessToken(codexAccess);
      return {
        access: codexAccess,
        accountId: codexAuth?.tokens?.account_id || token?.accountId || undefined,
        email: token?.email || null,
        source: codexAuthPath,
      };
    }

    return null;
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
      if (!auth?.access) {
        console.error("Codex auth profile missing: checked ~/.openclaw/agents/main/agent/auth-profiles.json and ~/.codex/auth.json");
        return codexQuotaCache.value || null;
      }

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

      console.log(`[codex-quota] fetchedAt=${new Date().toISOString()} source=${auth.source || "unknown"} email=${auth.email || "unknown"} accountId=${auth.accountId || "none"} raw=${JSON.stringify({primary_window: fiveHour, secondary_window: week})}`);

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

async function getXaiCredits() {
  if (!XAI_MANAGEMENT_API_KEY || !XAI_TEAM_ID) return null;

  const res = await httpsJson({
    hostname: "management-api.x.ai",
    path: `/v1/billing/teams/${encodeURIComponent(XAI_TEAM_ID)}/prepaid/balance`,
    headers: {
      Authorization: `Bearer ${XAI_MANAGEMENT_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const totalCentsRaw = res.data?.total?.val;
  if (res.status !== 200 || totalCentsRaw == null) {
    console.error("xAI prepaid balance error:", res.status, res.error || res.parseError || res.raw || "unknown");
    return null;
  }

  const totalCents = Number(totalCentsRaw);
  if (!Number.isFinite(totalCents)) {
    console.error("xAI prepaid balance parse error:", totalCentsRaw);
    return null;
  }

  return {
    prepaid_balance: Math.max(-totalCents, 0) / 100,
    prepaid_balance_cents: totalCents,
    currency: "USD",
    source: "management-api.x.ai/v1/billing/teams/:team_id/prepaid/balance",
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

function readRequestBuffer(req, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("payload too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendError(res, code, message) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body ?? null));
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizePublicPath(value) {
  const pathValue = stripTrailingSlash(String(value || "").trim());
  if (!pathValue) return "";
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

function normalizeOptionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeImageFormat(value) {
  return value === "png" || value === "jpg" || value === "webp" ? value : undefined;
}

function getImageMimeType(format) {
  if (format === "png") return "image/png";
  if (format === "jpg") return "image/jpeg";
  return "image/webp";
}

function getImageFormatFromMimeType(mimeType) {
  const normalized = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  return undefined;
}

function createReviewFigmaImageId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function sanitizeFilePart(value) {
  return String(value || "review")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "review";
}

function normalizeFigmaNodeId(value) {
  const nodeId = normalizeOptionalText(value);
  if (!nodeId) return undefined;
  return nodeId.includes(":") ? nodeId : nodeId.replace(/-/g, ":");
}

function parseReviewFigmaNodeRef(value) {
  const input = normalizeOptionalText(value);
  if (!input) return null;

  const [fileKey, nodeId, extra] = input.split("->").map(part => part.trim());
  if (fileKey && nodeId && extra === undefined) {
    const normalizedNodeId = normalizeFigmaNodeId(nodeId);
    return normalizedNodeId ? { fileKey, nodeId: normalizedNodeId } : null;
  }

  let figmaUrl;
  try {
    figmaUrl = new URL(input);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/i.test(figmaUrl.hostname)) return null;

  const parts = figmaUrl.pathname.split("/").filter(Boolean);
  const fileKeyIndex = parts.findIndex(part => ["design", "file", "proto", "board"].includes(part));
  const urlFileKey = fileKeyIndex >= 0 ? parts[fileKeyIndex + 1] : "";
  const urlNodeId = normalizeFigmaNodeId(figmaUrl.searchParams.get("node-id"));
  return urlFileKey && urlNodeId ? { fileKey: urlFileKey, nodeId: urlNodeId } : null;
}

function createReviewFigmaNodeUrl(ref, fileName = "Review") {
  const safeFileName = encodeURIComponent(fileName).replace(/%2F/gi, "-");
  const url = new URL(`https://www.figma.com/design/${encodeURIComponent(ref.fileKey)}/${safeFileName}`);
  url.searchParams.set("node-id", ref.nodeId.replace(/:/g, "-"));
  return url.toString();
}

function normalizeReviewFigmaUrl(value, ref) {
  const input = normalizeOptionalText(value);
  if (!input) return input;
  try {
    const url = new URL(input);
    if (/^https?:$/i.test(url.protocol) && /(^|\.)figma\.com$/i.test(url.hostname)) return input;
  } catch {}
  return createReviewFigmaNodeUrl(ref);
}

function normalizeReviewFigmaImageTarget(target) {
  if (target?.type === "figma-node") {
    return {
      type: "figma-node",
      projectId: target.projectId,
      fileKey: target.fileKey,
      nodeId: target.nodeId,
    };
  }

  return {
    type: "route",
    projectId: target.projectId,
    pageUrl: target.pageUrl,
    slot: target.slot || "",
    viewport: target.viewport
      ? {
          label: target.viewport.label || "",
          width: typeof target.viewport.width === "number" ? target.viewport.width : null,
          height: typeof target.viewport.height === "number" ? target.viewport.height : null,
          scope: target.viewport.scope || "",
        }
      : null,
  };
}

function getReviewFigmaImageTargetKey(target) {
  return JSON.stringify(normalizeReviewFigmaImageTarget(target));
}

function parseReviewFigmaImageTarget(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type === "route") {
    if (typeof value.projectId !== "string" || typeof value.pageUrl !== "string") return null;
    return {
      type: "route",
      projectId: value.projectId,
      pageUrl: value.pageUrl,
      viewport: value.viewport && typeof value.viewport === "object" ? value.viewport : undefined,
      slot: typeof value.slot === "string" ? value.slot : undefined,
    };
  }
  if (value.type === "figma-node") {
    if (
      typeof value.projectId !== "string" ||
      typeof value.fileKey !== "string" ||
      typeof value.nodeId !== "string"
    ) {
      return null;
    }
    return {
      type: "figma-node",
      projectId: value.projectId,
      fileKey: value.fileKey,
      nodeId: value.nodeId,
    };
  }
  return null;
}

function parseReviewFigmaImageTargetParam(value) {
  if (!value) return null;
  try {
    return parseReviewFigmaImageTarget(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseAddReviewFigmaImageInput(value) {
  if (!value || typeof value !== "object") return null;
  const target = parseReviewFigmaImageTarget(value.target);
  if (!target || typeof value.figmaUrl !== "string") return null;
  return {
    target,
    figmaUrl: value.figmaUrl,
    label: normalizeOptionalText(value.label),
    order: typeof value.order === "number" && Number.isFinite(value.order) ? value.order : undefined,
    imageFormat: normalizeImageFormat(value.imageFormat),
    asset: parseReviewFigmaImageAssetInput(value.asset),
  };
}

function parseReviewFigmaImageAssetInput(value) {
  if (!value || typeof value !== "object") return undefined;
  const imageFormat = normalizeImageFormat(value.imageFormat);
  if (!imageFormat || typeof value.dataUrl !== "string" || typeof value.mimeType !== "string") {
    return undefined;
  }
  return {
    dataUrl: value.dataUrl,
    imageFormat,
    mimeType: value.mimeType,
    byteSize: typeof value.byteSize === "number" ? value.byteSize : undefined,
    width: typeof value.width === "number" ? value.width : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
  };
}

function parseUpdateReviewFigmaImageInput(value) {
  if (!value || typeof value !== "object") return null;
  return {
    label: typeof value.label === "string" ? value.label : undefined,
    order: typeof value.order === "number" && Number.isFinite(value.order) ? value.order : undefined,
  };
}

function parseReorderReviewFigmaImagesInput(value) {
  if (!value || typeof value !== "object") return null;
  const target = parseReviewFigmaImageTarget(value.target);
  if (!target || !Array.isArray(value.imageIds)) return null;
  return {
    target,
    imageIds: value.imageIds.filter(id => typeof id === "string"),
  };
}

function decodeReviewFigmaImageAsset(asset) {
  const mimeType = String(asset.mimeType || "").split(";")[0].trim().toLowerCase();
  const imageFormat = getImageFormatFromMimeType(mimeType) || asset.imageFormat;
  if (!normalizeImageFormat(imageFormat)) throw new Error("Unsupported Figma image asset MIME type.");

  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(asset.dataUrl);
  if (!match) throw new Error("Valid Figma image asset data URL is required.");

  const dataUrlMimeType = String(match[1] || "").split(";")[0].trim().toLowerCase();
  if (dataUrlMimeType && dataUrlMimeType !== mimeType) {
    throw new Error("Figma image asset MIME type mismatch.");
  }

  return {
    data: Buffer.from(match[2].replace(/\s/g, ""), "base64"),
    imageFormat,
    mimeType,
  };
}

async function normalizeReviewFigmaImageBuffer(buffer, targetFormat) {
  const format = normalizeImageFormat(targetFormat) || "webp";
  let outputFormat = format;
  let output = buffer;
  try {
    if (format === "webp") output = await sharp(buffer).webp({ quality: 90 }).toBuffer();
    if (format === "jpg") output = await sharp(buffer).jpeg({ quality: 88 }).toBuffer();
    if (format === "png") output = await sharp(buffer).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  } catch (error) {
    if (format !== "webp") throw error;
    outputFormat = "png";
    output = await sharp(buffer).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  }

  const metadata = await sharp(output).metadata().catch(() => ({}));
  return {
    data: output,
    imageFormat: outputFormat,
    mimeType: getImageMimeType(outputFormat),
    width: typeof metadata.width === "number" ? metadata.width : undefined,
    height: typeof metadata.height === "number" ? metadata.height : undefined,
  };
}

async function renderReviewFigmaImageAsset({ figmaUrl, imageFormat, requestToken }) {
  const ref = parseReviewFigmaNodeRef(figmaUrl);
  if (!ref) throw new Error("A Figma node link or fileKey->nodeId value is required.");

  const token = normalizeOptionalText(requestToken) || normalizeOptionalText(process.env.FIGMA_TOKEN);
  if (!token) throw new Error("Figma token is required.");

  const targetFormat = normalizeImageFormat(imageFormat) || "webp";
  const renderFormat = targetFormat === "jpg" ? "jpg" : "png";
  const apiUrl = new URL(`/v1/images/${encodeURIComponent(ref.fileKey)}`, "https://api.figma.com");
  apiUrl.searchParams.set("ids", ref.nodeId);
  apiUrl.searchParams.set("format", renderFormat);

  const response = await fetch(apiUrl, { headers: { "X-Figma-Token": token } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.err || `Figma image render failed with ${response.status}`);
  }

  const imageUrl = body?.images?.[ref.nodeId];
  if (!imageUrl) throw new Error(`Figma image render returned no URL for ${ref.nodeId}.`);

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Figma image download failed with ${imageResponse.status}`);
  }

  const sourceData = Buffer.from(await imageResponse.arrayBuffer());
  const normalized = await normalizeReviewFigmaImageBuffer(sourceData, targetFormat);
  return { ...normalized, fileKey: ref.fileKey, nodeId: ref.nodeId };
}

function createReviewFigmaImageUrl(req, storageKey) {
  const protocol = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const origin = `${String(protocol).split(",")[0]}://${String(host).split(",")[0]}`;
  return new URL(`${REVIEW_FIGMA_IMAGES_PUBLIC_PATH}/${encodeURIComponent(storageKey)}`, origin).toString();
}

async function writeReviewFigmaImageAsset(req, { projectId, imageId, asset, figmaUrl, requestToken }) {
  const storageImageFormat = "webp";
  const renderedOrProvided = asset
    ? await normalizeReviewFigmaImageBuffer(
        decodeReviewFigmaImageAsset(asset).data,
        storageImageFormat
      )
    : await renderReviewFigmaImageAsset({
        figmaUrl,
        imageFormat: storageImageFormat,
        requestToken,
      });
  const format = renderedOrProvided.imageFormat;
  const storageKey = `${sanitizeFilePart(projectId)}_${sanitizeFilePart(imageId)}.${format === "jpg" ? "jpg" : format}`;
  const filePath = path.join(REVIEW_FIGMA_IMAGES_DIR, storageKey);

  fs.mkdirSync(REVIEW_FIGMA_IMAGES_DIR, { recursive: true });
  fs.writeFileSync(filePath, renderedOrProvided.data);

  let width = renderedOrProvided.width;
  let height = renderedOrProvided.height;
  if (!width || !height) {
    const metadata = await sharp(renderedOrProvided.data).metadata().catch(() => ({}));
    width = width || metadata.width;
    height = height || metadata.height;
  }

  return {
    imageUrl: createReviewFigmaImageUrl(req, storageKey),
    imageFormat: format,
    mimeType: renderedOrProvided.mimeType,
    storageKey,
    width,
    height,
    byteSize: renderedOrProvided.data.byteLength,
  };
}

function getSafeReviewFigmaImagePath(storageKey) {
  const decoded = decodeURIComponent(storageKey || "");
  if (!decoded || decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) return null;
  const filePath = path.join(REVIEW_FIGMA_IMAGES_DIR, decoded);
  const resolved = path.resolve(filePath);
  const root = path.resolve(REVIEW_FIGMA_IMAGES_DIR);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function sendReviewFigmaImageAsset(res, url) {
  const prefix = `${REVIEW_FIGMA_IMAGES_PUBLIC_PATH}/`;
  const storageKey = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
  const filePath = getSafeReviewFigmaImagePath(storageKey);
  if (!filePath || !fs.existsSync(filePath)) {
    sendError(res, 404, "not found");
    return;
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeTypes = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  fs.createReadStream(filePath).pipe(res);
}

function createReviewAttachmentId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `attachment-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function getMultipartBoundary(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] || match?.[2] || "";
}

function parseMultipartFormData(buffer, boundary) {
  const result = { fields: {}, files: {} };
  const boundaryText = `--${boundary}`;
  const parts = buffer.toString("binary").split(boundaryText);

  for (let part of parts) {
    if (!part || part === "--\r\n" || part === "--") continue;
    if (part.startsWith("\r\n")) part = part.slice(2);
    if (part.endsWith("\r\n")) part = part.slice(0, -2);
    if (part.endsWith("--")) part = part.slice(0, -2);

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const rawHeaders = part.slice(0, headerEnd);
    const bodyBinary = part.slice(headerEnd + 4);
    const disposition = rawHeaders.match(/content-disposition:\s*([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;

    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
    if (filename !== undefined) {
      result.files[name] = {
        filename,
        mime: contentType,
        data: Buffer.from(bodyBinary, "binary"),
      };
    } else {
      result.fields[name] = Buffer.from(bodyBinary, "binary").toString("utf8");
    }
  }

  return result;
}

function normalizeAttachmentMimeType(value) {
  const mime = String(value || "").split(";")[0].trim().toLowerCase();
  if (!mime || /[\r\n]/.test(mime)) return "application/octet-stream";
  return mime;
}

function getAttachmentExtension(name, mime) {
  const byMime = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/zip": "zip",
  }[mime];
  if (byMime) return byMime;

  const ext = path.extname(String(name || "")).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

function replaceFileExtension(name, ext) {
  const safeName = normalizeAttachmentName(name);
  const base = safeName.replace(/\.[^.]+$/, "") || "attachment";
  return `${base}.${ext}`;
}

function isReviewAttachmentRasterImage(mime) {
  return mime === "image/jpeg" || mime === "image/jpg" || mime === "image/png" || mime === "image/webp";
}

async function prepareReviewAttachmentAsset({ data, mime, name }) {
  if (mime === "image/svg+xml") {
    const compressed = zlib.gzipSync(data, { level: 9 });
    return {
      data: compressed,
      imageSource: data,
      mime,
      name,
      extension: "svgz",
      metadata: {
        compression: "gzip",
        originalMime: mime,
        originalName: name,
        originalSize: data.byteLength,
      },
    };
  }

  if (isReviewAttachmentRasterImage(mime)) {
    try {
      const converted = await sharp(data)
        .rotate()
        .webp({ quality: 82 })
        .toBuffer();
      return {
        data: converted,
        imageSource: converted,
        mime: "image/webp",
        name: replaceFileExtension(name, "webp"),
        extension: "webp",
        metadata: {
          conversion: "webp",
          originalMime: mime,
          originalName: name,
          originalSize: data.byteLength,
        },
      };
    } catch (error) {
      console.warn("[review-attachments] image conversion skipped:", error.message);
    }
  }

  return {
    data,
    imageSource: data,
    mime,
    name,
    extension: getAttachmentExtension(name, mime),
    metadata: {},
  };
}

async function createReviewAttachmentPreviewDataUrl(asset) {
  if (!asset.mime.startsWith("image/")) return undefined;

  try {
    const preview = await sharp(asset.imageSource)
      .rotate()
      .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 74 })
      .toBuffer();

    if (preview.byteLength > 256 * 1024) return undefined;
    return `data:image/webp;base64,${preview.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function getMimeTypeFromAttachmentPath(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    zip: "application/zip",
  }[ext] || "application/octet-stream";
}

function normalizeAttachmentName(value) {
  const name = path.basename(String(value || "attachment")).replace(/[\r\n]+/g, " ").trim();
  return name || "attachment";
}

function createReviewAttachmentUrl(req, storageKey) {
  const protocol = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const origin = `${String(protocol).split(",")[0]}://${String(host).split(",")[0]}`;
  return new URL(`${REVIEW_ATTACHMENTS_PUBLIC_PATH}/${encodeURIComponent(storageKey)}`, origin).toString();
}

function getSafeReviewAttachmentPath(storageKey) {
  const decoded = decodeURIComponent(storageKey || "");
  if (!decoded || decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) return null;
  const filePath = path.join(REVIEW_ATTACHMENTS_DIR, decoded);
  const resolved = path.resolve(filePath);
  const root = path.resolve(REVIEW_ATTACHMENTS_DIR);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

async function createReviewAttachment(req) {
  const contentType = req.headers["content-type"] || "";
  if (!String(contentType).includes("multipart/form-data")) {
    throw Object.assign(new Error("multipart/form-data is required."), { statusCode: 400 });
  }

  const boundary = getMultipartBoundary(contentType);
  if (!boundary) throw Object.assign(new Error("multipart boundary is required."), { statusCode: 400 });

  const form = parseMultipartFormData(await readRequestBuffer(req, REVIEW_ATTACHMENTS_MAX_BYTES), boundary);
  const file = form.files.file || Object.values(form.files)[0];
  if (!file?.data?.length) throw Object.assign(new Error("file is required."), { statusCode: 400 });

  const id = createReviewAttachmentId();
  const name = normalizeAttachmentName(form.fields.name || file.filename);
  const mime = normalizeAttachmentMimeType(form.fields.mime || file.mime);
  const kind = normalizeOptionalText(form.fields.kind) || (mime.startsWith("image/") ? "image" : "file");
  const projectId = normalizeOptionalText(req.headers["x-review-project"]) || "review";
  const source = normalizeOptionalText(req.headers["x-review-source"]) || REVIEW_FIGMA_IMAGES_SOURCE;
  const asset = await prepareReviewAttachmentAsset({ data: file.data, mime, name });
  const storageKey = `${sanitizeFilePart(projectId)}_${sanitizeFilePart(id)}.${asset.extension}`;
  const filePath = path.join(REVIEW_ATTACHMENTS_DIR, storageKey);
  const createdAt = new Date().toISOString();
  let metadata = {};
  if (form.fields.metadata) {
    try { metadata = JSON.parse(form.fields.metadata); } catch {}
  }

  fs.mkdirSync(REVIEW_ATTACHMENTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, asset.data);

  const imageMetadata = asset.mime.startsWith("image/")
    ? await sharp(asset.imageSource).metadata().catch(() => ({}))
    : {};
  const previewUrl = await createReviewAttachmentPreviewDataUrl(asset);
  const attachment = {
    id,
    url: createReviewAttachmentUrl(req, storageKey),
    ...(previewUrl ? { previewUrl } : {}),
    name: asset.name,
    mime: asset.mime,
    size: asset.data.byteLength,
    kind,
    width: typeof imageMetadata.width === "number" ? imageMetadata.width : undefined,
    height: typeof imageMetadata.height === "number" ? imageMetadata.height : undefined,
    metadata: {
      ...metadata,
      ...asset.metadata,
      storage: "usage-server",
      storageKey,
      source,
      ...(normalizeOptionalText(form.fields.item_id) ? { itemId: normalizeOptionalText(form.fields.item_id) } : {}),
    },
    createdAt,
  };

  fs.writeFileSync(`${filePath}.json`, JSON.stringify(attachment, null, 2));
  return attachment;
}

function sendReviewAttachmentAsset(res, url) {
  const prefix = `${REVIEW_ATTACHMENTS_PUBLIC_PATH}/`;
  const storageKey = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
  const filePath = getSafeReviewAttachmentPath(storageKey);
  if (!filePath || !fs.existsSync(filePath)) {
    sendError(res, 404, "not found");
    return;
  }

  let attachment = null;
  try { attachment = JSON.parse(fs.readFileSync(`${filePath}.json`, "utf8")); } catch {}
  const headers = {
    "Content-Type": attachment?.mime ? normalizeAttachmentMimeType(attachment.mime) : getMimeTypeFromAttachmentPath(filePath),
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "X-Content-Type-Options": "nosniff",
  };
  if (attachment?.metadata?.compression === "gzip" || filePath.endsWith(".svgz")) {
    headers["Content-Encoding"] = "gzip";
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

async function handleReviewAttachmentsRequest(req, res, url) {
  const endpoint = "/api/review/review-attachments";
  try {
    if (req.method === "POST" && url.pathname === endpoint) {
      sendJson(res, 201, await createReviewAttachment(req));
      return;
    }

    sendError(res, 405, "method not allowed.");
  } catch (error) {
    const status = error?.statusCode || 500;
    const message = status >= 500 ? "Review attachment endpoint failed." : error.message;
    if (status >= 500) console.error("[review-attachments]", error);
    sendError(res, status, message);
  }
}

async function requestReviewFigmaSupabase({ method = "GET", query = {}, body, prefer }) {
  if (!KUKU_SUPABASE_URL || !KUKU_SUPABASE_KEY) {
    throw new Error("KUKU_SUPABASE_URL and KUKU_SUPABASE_KEY are required.");
  }

  const requestUrl = new URL(`${KUKU_SUPABASE_URL}/rest/v1/${REVIEW_FIGMA_IMAGES_TABLE}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    requestUrl.searchParams.set(key, String(value));
  }

  const response = await fetch(requestUrl, {
    method,
    headers: {
      apikey: KUKU_SUPABASE_KEY,
      authorization: `Bearer ${KUKU_SUPABASE_KEY}`,
      accept: "application/json",
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) {
    const message = data && typeof data === "object" && data.message ? data.message : text;
    throw new Error(`Supabase ${method} ${REVIEW_FIGMA_IMAGES_TABLE} failed (${response.status}): ${message}`);
  }

  return data;
}

function getReviewFigmaImageSource(req) {
  return normalizeOptionalText(req.headers["x-review-source"]) || REVIEW_FIGMA_IMAGES_SOURCE;
}

function assertReviewFigmaProjectHeader(req, target) {
  const headerProject = normalizeOptionalText(req.headers["x-review-project"]);
  if (headerProject && target.projectId !== headerProject) {
    throw Object.assign(new Error("target project is not allowed."), { statusCode: 403 });
  }
}

async function listReviewFigmaImages(target, source) {
  const rows = await requestReviewFigmaSupabase({
    query: {
      select: "*",
      project_id: `eq.${target.projectId}`,
      source: `eq.${source}`,
      target_key: `eq.${getReviewFigmaImageTargetKey(target)}`,
      order: "sort_order.asc,created_at.asc",
    },
  });
  return Array.isArray(rows) ? rows.map(rowToReviewFigmaImage) : [];
}

async function createReviewFigmaImageRow(req, input) {
  const ref = parseReviewFigmaNodeRef(input.figmaUrl);
  if (!ref) throw new Error("A Figma node link or fileKey->nodeId value is required.");
  const figmaUrl = normalizeReviewFigmaUrl(input.figmaUrl, ref);

  const source = getReviewFigmaImageSource(req);
  const current = await listReviewFigmaImages(input.target, source);
  const id = createReviewFigmaImageId();
  const asset = await writeReviewFigmaImageAsset(req, {
    projectId: input.target.projectId,
    imageId: id,
    asset: input.asset,
    figmaUrl,
    imageFormat: input.imageFormat,
    requestToken: req.headers["x-figma-token"],
  });
  const now = new Date().toISOString();
  const order = typeof input.order === "number"
    ? input.order
    : current.length
      ? Math.max(...current.map(image => image.order)) + 1
      : 0;
  const target = input.target;
  const row = {
    id,
    project_id: target.projectId,
    source,
    target_key: getReviewFigmaImageTargetKey(target),
    target,
    target_type: target.type,
    page_url: target.type === "route" ? target.pageUrl : null,
    viewport_label: target.type === "route" ? target.viewport?.label ?? null : null,
    viewport_width: target.type === "route" ? target.viewport?.width ?? null : null,
    viewport_height: target.type === "route" ? target.viewport?.height ?? null : null,
    viewport_scope: target.type === "route" ? target.viewport?.scope ?? null : null,
    slot: target.type === "route" ? target.slot ?? null : null,
    figma_url: figmaUrl,
    file_key: ref.fileKey,
    node_id: ref.nodeId,
    image_url: asset.imageUrl,
    image_format: asset.imageFormat,
    mime_type: asset.mimeType,
    storage_key: asset.storageKey,
    label: input.label ?? null,
    sort_order: order,
    width: asset.width ?? null,
    height: asset.height ?? null,
    byte_size: asset.byteSize,
    created_at: now,
    updated_at: now,
  };

  try {
    const rows = await requestReviewFigmaSupabase({
      method: "POST",
      query: { select: "*" },
      body: row,
      prefer: "return=representation",
    });
    return rowToReviewFigmaImage(Array.isArray(rows) ? rows[0] : rows);
  } catch (error) {
    const filePath = getSafeReviewFigmaImagePath(asset.storageKey);
    if (filePath) fs.rmSync(filePath, { force: true });
    throw error;
  }
}

async function updateReviewFigmaImageRow(id, patch) {
  const body = {
    ...(patch.label !== undefined ? { label: normalizeOptionalText(patch.label) ?? null } : {}),
    ...(typeof patch.order === "number" ? { sort_order: patch.order } : {}),
    updated_at: new Date().toISOString(),
  };
  const rows = await requestReviewFigmaSupabase({
    method: "PATCH",
    query: { id: `eq.${id}`, select: "*" },
    body,
    prefer: "return=representation",
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw Object.assign(new Error(`Figma image not found: ${id}`), { statusCode: 404 });
  return rowToReviewFigmaImage(row);
}

async function reorderReviewFigmaImageRows(input, source) {
  const current = await listReviewFigmaImages(input.target, source);
  const currentIds = new Set(current.map(image => image.id));
  const nextIds = [
    ...input.imageIds.filter(id => currentIds.has(id)),
    ...current.map(image => image.id).filter(id => !input.imageIds.includes(id)),
  ];
  const updatedAt = new Date().toISOString();

  await Promise.all(nextIds.map((id, index) =>
    requestReviewFigmaSupabase({
      method: "PATCH",
      query: {
        id: `eq.${id}`,
        project_id: `eq.${input.target.projectId}`,
        source: `eq.${source}`,
        target_key: `eq.${getReviewFigmaImageTargetKey(input.target)}`,
      },
      body: { sort_order: index, updated_at: updatedAt },
    })
  ));

  return listReviewFigmaImages(input.target, source);
}

async function deleteReviewFigmaImageRow(id) {
  const rows = await requestReviewFigmaSupabase({
    query: { id: `eq.${id}`, select: "*", limit: 1 },
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw Object.assign(new Error(`Figma image not found: ${id}`), { statusCode: 404 });

  await requestReviewFigmaSupabase({
    method: "DELETE",
    query: { id: `eq.${id}` },
  });

  const filePath = getSafeReviewFigmaImagePath(row.storage_key);
  if (filePath) fs.rmSync(filePath, { force: true });
}

function rowToReviewFigmaImage(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    target: row.target,
    figmaUrl: row.figma_url,
    fileKey: row.file_key,
    nodeId: row.node_id,
    imageUrl: row.image_url,
    imageFormat: row.image_format,
    mimeType: row.mime_type,
    label: row.label ?? undefined,
    order: row.sort_order,
    storageKey: row.storage_key,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    byteSize: row.byte_size ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getReviewFigmaEndpointItemId(pathname, endpoint) {
  if (!pathname.startsWith(`${endpoint}/`)) return null;
  const value = pathname.slice(endpoint.length + 1);
  if (!value || value.includes("/")) return null;
  return decodeURIComponent(value);
}

async function handleReviewFigmaImagesRequest(req, res, url) {
  const endpoint = "/api/review/figma-images";
  try {
    if (req.method === "GET" && url.pathname === endpoint) {
      const target = parseReviewFigmaImageTargetParam(url.searchParams.get("target"));
      if (!target) { sendError(res, 400, "target query is required."); return; }
      assertReviewFigmaProjectHeader(req, target);
      sendJson(res, 200, await listReviewFigmaImages(target, getReviewFigmaImageSource(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === endpoint) {
      const input = parseAddReviewFigmaImageInput(JSON.parse((await parseBody(req)) || "null"));
      if (!input) { sendError(res, 400, "valid add image input is required."); return; }
      assertReviewFigmaProjectHeader(req, input.target);
      sendJson(res, 201, await createReviewFigmaImageRow(req, input));
      return;
    }

    if (req.method === "PATCH" && url.pathname === `${endpoint}/reorder`) {
      const input = parseReorderReviewFigmaImagesInput(JSON.parse((await parseBody(req)) || "null"));
      if (!input) { sendError(res, 400, "valid reorder input is required."); return; }
      assertReviewFigmaProjectHeader(req, input.target);
      sendJson(res, 200, await reorderReviewFigmaImageRows(input, getReviewFigmaImageSource(req)));
      return;
    }

    const id = getReviewFigmaEndpointItemId(url.pathname, endpoint);
    if (id && req.method === "PATCH") {
      const patch = parseUpdateReviewFigmaImageInput(JSON.parse((await parseBody(req)) || "null"));
      if (!patch) { sendError(res, 400, "valid update patch is required."); return; }
      sendJson(res, 200, await updateReviewFigmaImageRow(id, patch));
      return;
    }

    if (id && req.method === "DELETE") {
      await deleteReviewFigmaImageRow(id);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendError(res, 405, "method not allowed.");
  } catch (error) {
    const status = error?.statusCode || 500;
    const message = status >= 500 ? "Figma image endpoint failed." : error.message;
    if (status >= 500) console.error("[review-figma-images]", error);
    sendError(res, status, message);
  }
}

function serializeTodoItem(i) {
  return {
    id: i.id,
    title: i.title,
    content: i.content,
    status: i.status,
    is_today: !!i.is_today,
    review_count: i.review_count || 0,
    review_emoji: i.review_emoji || null,
    owner: i.owner || null,
    dispatch_nonce: i.dispatch_nonce || null,
    dispatch_message_id: i.dispatch_message_id || null,
    dispatch_channel_id: i.dispatch_channel_id || null,
    dispatch_message_url: i.dispatch_message_url || null,
    dispatch_target_bot_key: i.dispatch_target_bot_key || null,
    dispatch_target_bot_user_id: i.dispatch_target_bot_user_id || null,
    dispatch_started_at: i.dispatch_started_at || null,
    dispatch_attempt_count: i.dispatch_attempt_count || 0,
    dispatch_last_error: i.dispatch_last_error || null,
    today_queue_order: i.today_queue_order ?? null,
  };
}

function stripJsonComments(raw) {
  return String(raw || "").replace(/("(?:\\\\.|[^"\\\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str || "");
}

function readTodoQueueBotsConfig() {
  try {
    const raw = fs.readFileSync(VOICE_CONFIG_PATH, "utf8");
    const cfg = JSON.parse(stripJsonComments(raw));
    return cfg && typeof cfg.bots === "object" ? cfg.bots : {};
  } catch {
    return {};
  }
}

function resolveTodoQueueBot(botKey = DEFAULT_TODO_QUEUE_BOT_KEY) {
  const bots = readTodoQueueBotsConfig();
  const key = normalizeOptionalText(botKey) || DEFAULT_TODO_QUEUE_BOT_KEY;
  const raw = bots[key] || bots[DEFAULT_TODO_QUEUE_BOT_KEY] || {};
  return {
    key: raw === bots[key] ? key : DEFAULT_TODO_QUEUE_BOT_KEY,
    displayName: raw.displayName || "빵빵",
    discordUserId: raw.discordUserId || DEFAULT_TODO_QUEUE_BOT_USER_ID,
  };
}

function normalizeTodoQueueBotKey(botKey) {
  return resolveTodoQueueBot(botKey).key;
}

function sanitizeDiscordFilename(name, fallback = "attachment") {
  const base = path.basename(String(name || fallback)).replace(/[\r\n"\\]/g, "_");
  return base || fallback;
}

function discordImageContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
  }[ext] || "application/octet-stream";
}

function splitTodoContentAttachments(content) {
  const textLines = [];
  const imagePaths = [];
  for (const rawLine of String(content || "").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("/images/")) {
      const filename = path.basename(line.replace("/images/", ""));
      if (filename && !filename.includes("..")) imagePaths.push(path.join(__dirname, "images", filename));
      continue;
    }
    if (line) textLines.push(rawLine.trimEnd());
  }
  return { text: textLines.join("\n").trim(), imagePaths };
}

function collectTodoItemDispatchFiles(item) {
  const { imagePaths } = splitTodoContentAttachments(item.content);
  const files = [];
  for (const imagePath of imagePaths) {
    if (!fs.existsSync(imagePath)) continue;
    files.push({
      name: sanitizeDiscordFilename(`${item.id}_${path.basename(imagePath)}`),
      data: fs.readFileSync(imagePath),
      contentType: discordImageContentType(imagePath),
    });
  }
  return files;
}

function createDiscordMessageUrl(channelId, messageId) {
  if (!channelId || !messageId) return null;
  return `https://discord.com/channels/${GUILD_ID}/${channelId}/${messageId}`;
}

function createTodoQueueNonce() {
  return crypto.randomBytes(12).toString("hex");
}

function buildTodoQueueDispatchPrompt(item, { nonce, targetBot }) {
  const { text } = splitTodoContentAttachments(item.content);
  const body = text || "(content 없음)";
  const attachmentCount = collectTodoItemDispatchFiles(item).length;
  const marker = [
    "DUDU_RESULT_V1",
    "run_id: today-queue",
    `item_id: ${item.id}`,
    `nonce: ${nonce}`,
    "status: ready_for_review",
    "git_commit: <7-40자 commit SHA | not_applicable: repository 파일을 변경하지 않은 이유>",
    "evidence: <실제로 확인한 명령/파일/스크린샷/결과 요약>",
  ].join("\n");

  return buildBoundedDiscordPrompt({
    beforeLines: [
      `<@${targetBot.discordUserId}>`,
      "[DUDU_TASK_V1]",
      `project: ${item.project_emoji || ""} ${item.project_name || item.project_id || ""}`.trim(),
      item.category_name ? `category: ${item.category_name}` : null,
      `item_id: ${item.id}`,
      `nonce: ${nonce}`,
      `assignee: ${targetBot.displayName} (${targetBot.key})`,
      `title: ${item.title}`,
      attachmentCount ? `attachments: ${attachmentCount}` : "attachments: 0",
      "",
      "[task_content]",
    ],
    body,
    afterLines: [
      "",
      "[rules]",
      "- 이 메시지의 item 하나만 처리해.",
      "- 완료했다고 말만 하지 말고, 실제 변경/검증 결과를 evidence에 적어.",
      "- 코드·문서·설정 등 git repository 파일을 변경한 작업은 검증 후 해당 item 변경만 stage해서 반드시 commit해. 기존의 관련 없는 변경은 포함하지 마.",
      "- repository 파일을 변경하지 않은 작업만 git_commit에 `not_applicable: 이유`를 적을 수 있어. 그 외에는 실제 commit SHA를 적어.",
      "- 작업이 끝나면 답변 마지막에 아래 marker를 정확히 채워서 보내.",
      "- marker가 없거나 item_id/nonce가 다르면 두두 큐는 다음 항목으로 진행하지 않는다.",
      `- 선행 관계 때문에 대기 순서를 바꿔야 하면 \`~/.openclaw/workspace/scripts/todo.sh queue move ${item.project_id} <item_id> --before|--after <anchor_item_id>\`를 사용해. 실행 중 항목은 고정되고 todo 대기 항목만 이동된다.`,
      "- done 처리는 하지 않는다. 큐는 ready_for_review marker를 받으면 review까지만 넘긴다.",
      "",
      "```text",
      marker,
      "```",
    ],
  });
}

function sendDiscordChannelMessage(channelId, {
  content,
  files = [],
  allowedUserIds = [],
  nonce = null,
  enforceNonce = false,
  timeoutMs = 10_000,
}, botToken) {
  return new Promise((resolve, reject) => {
    if (!botToken) { reject(new Error("Discord bot token not configured")); return; }
    if (!channelId) { reject(new Error("Discord channel id required")); return; }
    const payloadJson = {
      content,
      allowed_mentions: {
        parse: [],
        users: allowedUserIds.filter(Boolean),
        replied_user: false,
      },
      ...(nonce ? { nonce: String(nonce).slice(0, 25), enforce_nonce: Boolean(enforceNonce) } : {}),
    };

    const finish = (dRes) => {
      let responseText = "";
      dRes.on("data", c => responseText += c);
      dRes.on("end", () => {
        let parsed = null;
        try { parsed = responseText ? JSON.parse(responseText) : null; } catch {}
        if (dRes.statusCode < 200 || dRes.statusCode >= 300) {
          reject(Object.assign(
            new Error(`Discord POST ${dRes.statusCode}: ${responseText.slice(0, 300)}`),
            { statusCode: dRes.statusCode, code: `discord_http_${dRes.statusCode}` },
          ));
          return;
        }
        resolve(parsed || { raw: responseText });
      });
    };

    if (!files.length) {
      const payload = JSON.stringify(payloadJson);
      const dReq = https.request({
        hostname: "discord.com",
        path: `/api/v10/channels/${channelId}/messages`,
        method: "POST",
        headers: {
          "Authorization": `Bot ${botToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      }, finish);
      dReq.setTimeout(timeoutMs, () => {
        dReq.destroy(Object.assign(new Error("Discord POST timed out"), { code: "discord_timeout" }));
      });
      dReq.on("error", reject);
      dReq.write(payload);
      dReq.end();
      return;
    }

    const boundary = `----DuduDispatch${Date.now()}${Math.random().toString(16).slice(2)}`;
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payloadJson)}\r\n`,
    ];
    files.forEach((file, i) => {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="files[${i}]"; filename="${sanitizeDiscordFilename(file.name, `file-${i}`)}"\r\nContent-Type: ${file.contentType || "application/octet-stream"}\r\n\r\n`);
      parts.push(file.data);
      parts.push("\r\n");
    });
    parts.push(`--${boundary}--\r\n`);
    const body = Buffer.concat(parts.map(part => typeof part === "string" ? Buffer.from(part) : part));
    const dReq = https.request({
      hostname: "discord.com",
      path: `/api/v10/channels/${channelId}/messages`,
      method: "POST",
      headers: {
        "Authorization": `Bot ${botToken}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    }, finish);
    dReq.setTimeout(timeoutMs, () => {
      dReq.destroy(Object.assign(new Error("Discord POST timed out"), { code: "discord_timeout" }));
    });
    dReq.on("error", reject);
    dReq.write(body);
    dReq.end();
  });
}

function recordTodoDispatchFailure(itemId, error) {
  const message = String(error?.message || error || "dispatch failed").slice(0, 1000);
  db.prepare("UPDATE items SET dispatch_last_error=? WHERE id=?").run(message, itemId);
}

async function dispatchTodoItemToDiscord(item, {
  botKey = DEFAULT_TODO_QUEUE_BOT_KEY,
  nonce = createTodoQueueNonce(),
} = {}) {
  const channelId = item.discord_thread_id || item.discord_channel_id;
  if (!channelId) throw new Error(`item #${item.id} project has no Discord channel/thread mapping`);
  const botToken = TODAY_QUEUE_DISPATCH_TOKEN;
  const targetBot = resolveTodoQueueBot(botKey);
  const files = collectTodoItemDispatchFiles(item);
  const content = buildTodoQueueDispatchPrompt(item, { nonce, targetBot });
  const message = await sendDiscordChannelMessage(channelId, {
    content,
    files,
    allowedUserIds: [targetBot.discordUserId],
  }, botToken);
  const messageId = message?.id || null;
  const messageUrl = createDiscordMessageUrl(channelId, messageId);
  return { item_id: item.id, channel_id: channelId, message_id: messageId, message_url: messageUrl, nonce, target_bot: targetBot.key, target_bot_user_id: targetBot.discordUserId };
}

const todayQueueHistoryService = createTodayQueueHistoryService({ db });
const todayQueueRunLifecycle = createTodayQueueRunLifecycle({ db });
const todayQueueService = createTodayQueueService({
  db,
  serializeTodoItem,
  normalizeBotKey: normalizeTodoQueueBotKey,
  defaultBotKey: DEFAULT_TODO_QUEUE_BOT_KEY,
  dispatchItem: dispatchTodoItemToDiscord,
  recordFailure: recordTodoDispatchFailure,
  runLifecycle: todayQueueRunLifecycle,
  createDispatchNonce: createTodoQueueNonce,
});
todayQueueService.initializeOrder();

function buildTodayQueueStatus(projectId = null, extra = {}) {
  return todayQueueService.buildStatus({ projectId, extra });
}

async function dispatchNextTodayQueueItem({
  projectId = null,
  botKey = null,
  allowWhenRunning = false,
  startedBy = "api",
  expectedRunId = null,
} = {}) {
  return todayQueueService.dispatchNext({
    projectId,
    botKey,
    allowWhenRunning,
    startedBy,
    expectedRunId,
  });
}

function stopTodayQueue({ projectId = null } = {}) {
  return todayQueueService.stop({ projectId });
}

function getTodayQueueItemById(itemId) {
  return todayQueueService.getItemById(itemId);
}

function validateTodayQueueProjectId(value) {
  const projectId = todayQueueService.normalizeProjectId(value);
  if (projectId === undefined) return { error: "project_id must be a positive integer", status: 400 };
  if (projectId !== null && !todayQueueService.projectExists(projectId)) {
    return { error: "project not found", status: 404 };
  }
  return { projectId };
}

const handleTodayQueueResultMarkerMessage = createTodayQueueResultHandler({
  getItemById: getTodayQueueItemById,
  validateGitCommitDeclaration,
  acceptResult: ({ item, marker, msg, gitCommit }) => todayQueueRunLifecycle.acceptResult({
    itemId: item.id,
    nonce: marker.nonce,
    resultMessageId: msg.id || null,
    resultMessageUrl: msg.url || createDiscordMessageUrl(msg.channelId || msg.channel?.id, msg.id),
    gitCommit,
  }),
  dispatchNext: (projectId, options = {}) => dispatchNextTodayQueueItem({
    projectId,
    startedBy: options.startedBy || "result-marker",
    expectedRunId: options.runId || null,
  }),
  broadcast: broadcastSSE,
});

function startTodayQueueBridge() {
  if (!TODAY_QUEUE_BRIDGE_ENABLED) {
    console.log("[today-queue-bridge] disabled by TODAY_QUEUE_BRIDGE_ENABLED=false");
    return;
  }

  try {
    require("./today-queue-bridge").start({
      token: TODAY_QUEUE_BRIDGE_TOKEN,
      onResult: handleTodayQueueResultMarkerMessage,
      getActiveItems: () => todayQueueService.getItems(["in_progress"]),
    });
  } catch (error) {
    console.error("[today-queue-bridge] failed to start:", error?.message || error);
  }
}

// --- SSE (Server-Sent Events) ---
const sseClients = new Set();

function broadcastSSE(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

const meetingSummaryJobService = createMeetingSummaryJobService({
  db,
  onCompleted: ({ recordId, generation }) => {
    broadcastSSE("meeting-summary", { meetingId: recordId, generation, status: "completed" });
  },
});
const recoveredMeetingSummaryJobs = meetingSummaryJobService.recoverInterruptedJobs();
if (recoveredMeetingSummaryJobs > 0) {
  console.log(`[meeting-summary-jobs] recovered ${recoveredMeetingSummaryJobs} interrupted job(s)`);
}

const sillokSummaryDispatcher = createSillokSummaryDispatcher({
  summaryJobs: meetingSummaryJobService,
  channelId: SILLOK_SUMMARY_DISPATCH_CHANNEL_ID,
  targetUserId: DEFAULT_TODO_QUEUE_BOT_USER_ID,
  pollIntervalMs: SILLOK_SUMMARY_DISPATCH_POLL_MS,
  sendTimeoutMs: SILLOK_SUMMARY_DISPATCH_TIMEOUT_MS,
  retryDelayMs: SILLOK_SUMMARY_DISPATCH_RETRY_MS,
  sendMessage: ({ channelId, ...payload }) => sendDiscordChannelMessage(
    channelId,
    payload,
    SILLOK_SUMMARY_DISPATCH_TOKEN,
  ),
});
const sillokSummaryReconciler = createSillokSummaryReconciler({
  summaryJobs: meetingSummaryJobService,
  dispatcher: sillokSummaryDispatcher,
  intervalMs: SILLOK_SUMMARY_RECONCILE_MS,
  dispatchTimeoutMs: SILLOK_SUMMARY_DISPATCH_STALE_MS,
  acknowledgementTimeoutMs: SILLOK_SUMMARY_ACK_TIMEOUT_MS,
  maxAttempts: SILLOK_SUMMARY_MAX_ATTEMPTS,
});
if (SILLOK_SUMMARY_DISPATCH_ENABLED) {
  sillokSummaryDispatcher.start();
  sillokSummaryReconciler.start();
} else {
  console.log("[sillok-summary-dispatcher] disabled");
  console.log("[sillok-summary-reconciler] disabled");
}

// Heartbeat — 좀비 커넥션 정리 (30초마다 ping)
setInterval(() => {
  for (const client of sseClients) {
    try { client.write(": ping\n\n"); } catch { sseClients.delete(client); }
  }
}, 30000);

function normalizeMeetingId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id) ? id : null;
}

function normalizeMeetingDate(value, recordedAt) {
  const date = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date(recordedAt).toISOString().slice(0, 10);
}

function createMeetingAudioUrl(req, meetingId) {
  const protocol = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  return `${String(protocol).split(",")[0]}://${String(host).split(",")[0]}/api/meetings/${encodeURIComponent(meetingId)}/audio`;
}

function parseMeetingJSON(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeMeetingSpeakerNames(value, fallback = {}) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("speaker_names must be an object"), { statusCode: 400 });
  }
  const names = {};
  for (const [speakerId, rawName] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(speakerId)) continue;
    const name = normalizeOptionalText(rawName);
    if (name) names[speakerId] = name.slice(0, 40);
  }
  return names;
}

function serializeMeeting(req, row) {
  const words = parseMeetingJSON(row.transcription_words_json);
  const segments = parseMeetingJSON(row.transcription_segments_json);
  const audioFilePath = getMeetingArchivePath(row.audio_path);
  const audioAvailable = !row.audio_deleted_at && Boolean(audioFilePath && fs.existsSync(audioFilePath));
  return {
    id: row.id,
    record_number: row.record_number,
    recorded_at: row.recorded_at,
    recorded_date: row.recorded_date,
    title: row.title || null,
    title_source: row.title_source || "default",
    summary: row.summary || null,
    transcript: row.transcript,
    speaker_names: parseMeetingJSON(row.speaker_names_json, {}),
    audio_path: row.audio_path,
    audio_url: audioAvailable ? createMeetingAudioUrl(req, row.id) : null,
    audio_available: audioAvailable,
    audio_deleted_at: row.audio_deleted_at || null,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    duration_seconds: row.duration_seconds,
    sha256: row.sha256,
    context: {
      time: row.time_label || buildTimeLabel(row.recorded_at),
      location: row.location_label || null,
      location_available: Number.isFinite(row.location_lat) && Number.isFinite(row.location_lng),
      location_accuracy: row.location_accuracy ?? null,
      weather: row.weather_label || null,
      weather_observed_at: row.weather_observed_at || null,
    },
    transcription: {
      status: row.transcription_status || "idle",
      attempts: row.transcription_attempts || 0,
      error: row.transcription_error || null,
      model: row.transcription_model || null,
      transcription_id: row.transcription_id || null,
      language_code: row.transcription_language || null,
      language_probability: row.transcription_language_probability ?? null,
      audio_duration_seconds: row.transcription_duration_seconds ?? null,
      speakers: [...new Set(segments.map(segment => segment.speaker_id).filter(Boolean))],
      options: parseMeetingJSON(row.transcription_options_json, {}),
      words,
      segments,
      updated_at: row.transcription_updated_at || null,
    },
    summary_generation: {
      status: row.summary_status || "idle",
      model: row.summary_model || null,
      error: row.summary_error || null,
      updated_at: row.summary_updated_at || null,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getMeetingArchivePath(relativePath) {
  const root = path.resolve(MEETING_ARCHIVE_DIR);
  const resolved = path.resolve(root, String(relativePath || ""));
  if (!resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

async function receiveMeetingAudio(req, meetingId) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MEETING_UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error("meeting audio is too large"), { statusCode: 413 });
  }

  const existing = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
  const recordedAtHeader = String(req.headers["x-recorded-at"] || "").trim();
  const recordedAtDate = recordedAtHeader ? new Date(recordedAtHeader) : new Date();
  if (!Number.isFinite(recordedAtDate.getTime())) {
    throw Object.assign(new Error("X-Recorded-At must be an ISO date"), { statusCode: 400 });
  }

  const recordedAt = existing?.recorded_at || recordedAtDate.toISOString();
  const recordedDate = existing?.recorded_date || normalizeMeetingDate(req.headers["x-recorded-date"], recordedAt);
  const uploadedLocation = normalizeLocation({
    lat: req.headers["x-location-lat"],
    lng: req.headers["x-location-lng"],
    accuracy: req.headers["x-location-accuracy"],
    ts: req.headers["x-location-timestamp"],
  });
  const location = uploadedLocation || (Number.isFinite(existing?.location_lat) && Number.isFinite(existing?.location_lng)
    ? {
        lat: existing.location_lat,
        lng: existing.location_lng,
        accuracy: existing.location_accuracy,
        ts: existing.location_timestamp,
      }
    : null);
  const locationLabel = existing?.location_label || await resolveLocationLabel(location).catch(() => "");
  const weather = existing?.weather_label
    ? { label: existing.weather_label, observedAt: existing.weather_observed_at }
    : readWeatherSnapshot(recordedAtDate.getTime());
  const timeLabel = existing?.time_label || buildTimeLabel(recordedAt);
  const [year, month, day] = recordedDate.split("-");
  const requestedName = path.basename(String(req.headers["x-original-filename"] || "meeting.m4a"));
  const requestedExtension = path.extname(requestedName).slice(1).toLowerCase();
  const extension = /^[a-z0-9]{1,8}$/.test(requestedExtension) ? requestedExtension : "m4a";
  const relativePath = existing?.audio_path || path.posix.join(year, month, day, meetingId, `original.${extension}`);
  const filePath = getMeetingArchivePath(relativePath);
  if (!filePath) throw Object.assign(new Error("invalid meeting archive path"), { statusCode: 400 });

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.upload-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > MEETING_UPLOAD_MAX_BYTES) {
        callback(Object.assign(new Error("meeting audio is too large"), { statusCode: 413 }));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(req, counter, fs.createWriteStream(tempPath, { flags: "wx" }));
    if (sizeBytes === 0) throw Object.assign(new Error("meeting audio is empty"), { statusCode: 400 });
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  const durationHeader = Number(req.headers["x-duration-seconds"]);
  const durationSeconds = Number.isFinite(durationHeader) && durationHeader >= 0 ? durationHeader : null;
  const mimeType = normalizeAttachmentMimeType(req.headers["content-type"] || "audio/mp4");
  const sha256 = hash.digest("hex");
  const recordNumber = existing?.record_number
    || db.prepare("SELECT COALESCE(MAX(record_number), 0) + 1 AS value FROM meetings").get().value;
  db.prepare(`
    INSERT INTO meetings (
      id, record_number, recorded_at, recorded_date, audio_path, original_filename,
      mime_type, size_bytes, duration_seconds, sha256,
      location_lat, location_lng, location_accuracy, location_timestamp, location_label,
      time_label, weather_label, weather_observed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      audio_path=excluded.audio_path,
      original_filename=excluded.original_filename,
      mime_type=excluded.mime_type,
      size_bytes=excluded.size_bytes,
      duration_seconds=excluded.duration_seconds,
      sha256=excluded.sha256,
      location_lat=COALESCE(excluded.location_lat, meetings.location_lat),
      location_lng=COALESCE(excluded.location_lng, meetings.location_lng),
      location_accuracy=COALESCE(excluded.location_accuracy, meetings.location_accuracy),
      location_timestamp=COALESCE(excluded.location_timestamp, meetings.location_timestamp),
      location_label=COALESCE(excluded.location_label, meetings.location_label),
      time_label=COALESCE(excluded.time_label, meetings.time_label),
      weather_label=COALESCE(excluded.weather_label, meetings.weather_label),
      weather_observed_at=COALESCE(excluded.weather_observed_at, meetings.weather_observed_at),
      audio_deleted_at=NULL,
      transcription_status='idle',
      transcription_error=NULL,
      transcription_id=NULL,
      transcription_language=NULL,
      transcription_language_probability=NULL,
      transcription_duration_seconds=NULL,
      transcription_words_json=NULL,
      transcription_segments_json=NULL,
      transcript=NULL,
      speaker_names_json=NULL,
      summary=NULL,
      summary_status='idle',
      summary_model=NULL,
      summary_error=NULL,
      summary_updated_at=NULL,
      updated_at=datetime('now')
  `).run(
    meetingId,
    recordNumber,
    recordedAt,
    recordedDate,
    relativePath,
    requestedName,
    mimeType,
    sizeBytes,
    durationSeconds,
    sha256,
    location?.lat ?? null,
    location?.lng ?? null,
    location?.accuracy ?? null,
    location?.ts ?? null,
    locationLabel || null,
    timeLabel || null,
    weather?.label || null,
    weather?.observedAt || null
  );

  return db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
}

function sendMeetingAudio(req, res, row) {
  const filePath = getMeetingArchivePath(row.audio_path);
  if (row.audio_deleted_at || !filePath || !fs.existsSync(filePath)) {
    sendError(res, 404, "meeting audio not found");
    return;
  }

  const stat = fs.statSync(filePath);
  const range = String(req.headers.range || "").match(/^bytes=(\d*)-(\d*)$/);
  const headers = {
    "Content-Type": row.mime_type || "audio/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${path.basename(row.original_filename).replace(/[\r\n\"]/g, "_")}"`,
  };

  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stat.size) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  fs.createReadStream(filePath).pipe(res);
}

const activeMeetingTranscriptions = new Set();

function getMeetingTranscriptionModel() {
  if (/^scribe_v[12]$/.test(process.env.MEETING_TRANSCRIPTION_MODEL || "")) {
    return process.env.MEETING_TRANSCRIPTION_MODEL;
  }
  try {
    const config = JSON.parse(fs.readFileSync(VOICE_CONFIG_PATH, "utf8"));
    if (/^scribe_v[12]$/.test(config.sttModel || "")) return config.sttModel;
  } catch {}
  return "scribe_v1";
}

function normalizeTranscriptionOptions(value = {}, fallback = {}) {
  const input = value && typeof value === "object" ? value : {};
  const model = /^scribe_v[12]$/.test(input.model_id || "")
    ? input.model_id
    : (/^scribe_v[12]$/.test(fallback.model_id || "") ? fallback.model_id : getMeetingTranscriptionModel());
  const language = String(input.language_code ?? fallback.language_code ?? process.env.MEETING_TRANSCRIPTION_LANGUAGE ?? "").trim();
  const speakerCount = Number(input.num_speakers ?? fallback.num_speakers);
  return {
    model_id: model,
    ...(language && /^[a-zA-Z]{2,3}$/.test(language) ? { language_code: language.toLowerCase() } : {}),
    ...(Number.isInteger(speakerCount) && speakerCount >= 1 && speakerCount <= 32 ? { num_speakers: speakerCount } : {}),
    diarize: true,
    timestamps_granularity: "word",
    tag_audio_events: true,
  };
}

function createMultipartField(boundary, name, value) {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    "utf8"
  );
}

async function callScribeForMeeting(row, options) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
  const filePath = getMeetingArchivePath(row.audio_path);
  if (!filePath || !fs.existsSync(filePath)) throw new Error("meeting audio not found");

  const stat = await fs.promises.stat(filePath);
  const boundary = `bbmeeting-${crypto.randomBytes(18).toString("hex")}`;
  const fields = [
    createMultipartField(boundary, "model_id", options.model_id),
    createMultipartField(boundary, "diarize", "true"),
    createMultipartField(boundary, "timestamps_granularity", "word"),
    createMultipartField(boundary, "tag_audio_events", "true"),
  ];
  if (options.language_code) fields.push(createMultipartField(boundary, "language_code", options.language_code));
  if (options.num_speakers) fields.push(createMultipartField(boundary, "num_speakers", String(options.num_speakers)));

  const safeFilename = path.basename(row.original_filename || "meeting.m4a").replace(/[\r\n\"]/g, "_");
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${row.mime_type || "audio/mp4"}\r\n\r\n`,
    "utf8"
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const contentLength = fields.reduce((total, field) => total + field.length, 0) + fileHeader.length + stat.size + closing.length;
  const body = Readable.from((async function* streamMultipart() {
    for (const field of fields) yield field;
    yield fileHeader;
    for await (const chunk of fs.createReadStream(filePath)) yield chunk;
    yield closing;
  })());

  const timeoutMs = Math.max(60_000, Number(process.env.MEETING_TRANSCRIPTION_TIMEOUT_MS) || 2 * 60 * 60 * 1000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Scribe transcription timed out")), timeoutMs);
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(contentLength),
      },
      body,
      duplex: "half",
      signal: controller.signal,
    });
    const responseText = await response.text();
    let payload;
    try { payload = JSON.parse(responseText); } catch { payload = null; }
    if (!response.ok) {
      const detail = payload?.detail?.message || payload?.detail || payload?.message || responseText || `HTTP ${response.status}`;
      throw new Error(`Scribe ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
    if (!payload || !Array.isArray(payload.words)) throw new Error("Scribe response did not include words");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeScribeWords(words) {
  return words.map((word, index) => ({
    index,
    text: String(word?.text || ""),
    start: Number.isFinite(Number(word?.start)) ? Number(word.start) : null,
    end: Number.isFinite(Number(word?.end)) ? Number(word.end) : null,
    type: ["word", "spacing", "audio_event"].includes(word?.type) ? word.type : "word",
    speaker_id: normalizeOptionalText(word?.speaker_id) || null,
    logprob: Number.isFinite(Number(word?.logprob)) ? Number(word.logprob) : null,
  }));
}

function buildSpeakerSegments(words) {
  const segments = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.text = current.text.trim();
    if (current.text) segments.push(current);
    current = null;
  };

  for (const word of words) {
    const speakerId = word.speaker_id || current?.speaker_id || "speaker_unknown";
    if (!current || (word.type !== "spacing" && speakerId !== current.speaker_id)) {
      flush();
      current = {
        speaker_id: speakerId,
        start: word.start,
        end: word.end,
        text: "",
        word_start_index: word.index,
        word_end_index: word.index,
      };
    }
    current.text += word.text;
    if (current.start == null && word.start != null) current.start = word.start;
    if (word.end != null) current.end = word.end;
    current.word_end_index = word.index;
  }
  flush();
  return segments;
}

const activeMeetingSummaries = new Set();

function getMeetingSummaryModel() {
  return process.env.MEETING_SUMMARY_MODEL || "anthropic/claude-sonnet-5";
}

async function processMeetingSummary(meetingId) {
  if (activeMeetingSummaries.has(meetingId)) return;
  activeMeetingSummaries.add(meetingId);
  const model = getMeetingSummaryModel();
  try {
    let row = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
    if (!row) throw new Error("meeting not found");
    if (row.transcription_status !== "completed" || !String(row.transcript || "").trim()) {
      throw new Error("completed meeting transcript is required");
    }
    db.prepare(`
      UPDATE meetings
         SET summary_status='processing',
             summary_model=?,
             summary_error=NULL,
             summary_updated_at=datetime('now'),
             updated_at=datetime('now')
       WHERE id=?
    `).run(model, meetingId);

    const generator = createMeetingSummaryGenerator({
      apiKey: OPENROUTER_API_KEY,
      apiUrl: process.env.MEETING_SUMMARY_API_URL,
      model,
      timeoutMs: Math.max(30_000, Number(process.env.MEETING_SUMMARY_TIMEOUT_MS) || 60_000),
    });
    const generated = await generator.generate(row.transcript);
    row = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
    if (!row) return;
    const preserveUserTitle = row.title_source === "user";
    db.prepare(`
      UPDATE meetings
         SET title=?,
             title_source=?,
             summary=?,
             summary_status='completed',
             summary_model=?,
             summary_error=NULL,
             summary_updated_at=datetime('now'),
             updated_at=datetime('now')
       WHERE id=?
    `).run(
      preserveUserTitle ? row.title : generated.title,
      preserveUserTitle ? "user" : "ai",
      generated.summary,
      generated.model,
      meetingId
    );
    broadcastSSE("meeting-summary", { meetingId, status: "completed" });
  } catch (error) {
    const message = String(error?.message || error || "summary generation failed").slice(0, 2000);
    db.prepare(`
      UPDATE meetings
         SET summary_status='failed',
             summary_model=?,
             summary_error=?,
             summary_updated_at=datetime('now'),
             updated_at=datetime('now')
       WHERE id=?
    `).run(model, message, meetingId);
    broadcastSSE("meeting-summary", { meetingId, status: "failed", error: message });
    console.error(`[meeting-summary] ${meetingId}:`, message);
  } finally {
    activeMeetingSummaries.delete(meetingId);
  }
}

function queueMeetingSummary(meetingId, force = false) {
  const row = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
  if (!row) throw Object.assign(new Error("meeting not found"), { statusCode: 404 });
  if (activeMeetingSummaries.has(meetingId) || ["queued", "processing"].includes(row.summary_status)) {
    return row;
  }
  if (!force && row.summary_status === "completed") return row;
  if (row.transcription_status !== "completed" || !String(row.transcript || "").trim()) {
    throw Object.assign(new Error("completed meeting transcript is required"), { statusCode: 409 });
  }
  db.prepare(`
    UPDATE meetings
       SET summary_status='queued',
           summary_model=?,
           summary_error=NULL,
           summary_updated_at=datetime('now'),
           updated_at=datetime('now')
     WHERE id=?
  `).run(getMeetingSummaryModel(), meetingId);
  setImmediate(() => processMeetingSummary(meetingId));
  return db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
}

async function processMeetingTranscription(meetingId) {
  if (activeMeetingTranscriptions.has(meetingId)) return;
  activeMeetingTranscriptions.add(meetingId);
  try {
    let row = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
    if (!row) throw new Error("meeting not found");
    const options = normalizeTranscriptionOptions(parseMeetingJSON(row.transcription_options_json, {}));
    db.prepare(`
      UPDATE meetings
         SET transcription_status='processing',
             transcription_attempts=COALESCE(transcription_attempts,0)+1,
             transcription_error=NULL,
             transcription_model=?,
             transcription_updated_at=datetime('now'),
             updated_at=datetime('now')
       WHERE id=?
    `).run(options.model_id, meetingId);

    row = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
    const result = await callScribeForMeeting(row, options);
    const words = normalizeScribeWords(result.words);
    const segments = buildSpeakerSegments(words);
    db.prepare(`
      UPDATE meetings
         SET transcription_status='completed',
             transcription_error=NULL,
             transcription_model=?,
             transcription_id=?,
             transcription_language=?,
             transcription_language_probability=?,
             transcription_duration_seconds=?,
             transcription_words_json=?,
             transcription_segments_json=?,
             transcript=?,
             transcription_updated_at=datetime('now'),
             updated_at=datetime('now')
       WHERE id=?
    `).run(
      options.model_id,
      normalizeOptionalText(result.transcription_id) || null,
      normalizeOptionalText(result.language_code) || null,
      Number.isFinite(Number(result.language_probability)) ? Number(result.language_probability) : null,
      Number.isFinite(Number(result.audio_duration_secs)) ? Number(result.audio_duration_secs) : row.duration_seconds,
      JSON.stringify(words),
      JSON.stringify(segments),
      String(result.text || "").trim(),
      meetingId
    );
    broadcastSSE("meeting-transcription", { meetingId, status: "completed", speakers: [...new Set(segments.map(segment => segment.speaker_id))] });
    if (MEETING_AGENT_SUMMARY_ENABLED) {
      meetingSummaryJobService.createJob(meetingId, { trigger: "transcription_completed" });
    } else {
      queueMeetingSummary(meetingId, true);
    }
  } catch (error) {
    const message = String(error?.message || error || "transcription failed").slice(0, 2000);
    db.prepare(`
      UPDATE meetings
         SET transcription_status='failed',
             transcription_error=?,
             transcription_updated_at=datetime('now'),
             updated_at=datetime('now')
       WHERE id=?
    `).run(message, meetingId);
    broadcastSSE("meeting-transcription", { meetingId, status: "failed", error: message });
    console.error(`[meeting-transcription] ${meetingId}:`, message);
  } finally {
    activeMeetingTranscriptions.delete(meetingId);
  }
}

function queueMeetingTranscription(meetingId, requestedOptions = {}, force = false) {
  const row = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
  if (!row) throw Object.assign(new Error("meeting not found"), { statusCode: 404 });
  if (activeMeetingTranscriptions.has(meetingId) || ["queued", "processing"].includes(row.transcription_status)) {
    return row;
  }
  if (!force && row.transcription_status === "completed") return row;

  const existingOptions = parseMeetingJSON(row.transcription_options_json, {});
  const options = normalizeTranscriptionOptions(requestedOptions, existingOptions);
  db.prepare(`
    UPDATE meetings
       SET transcription_status='queued',
           transcription_error=NULL,
           transcription_model=?,
           transcription_options_json=?,
           transcription_updated_at=datetime('now'),
           updated_at=datetime('now')
     WHERE id=?
  `).run(options.model_id, JSON.stringify(options), meetingId);
  setImmediate(() => processMeetingTranscription(meetingId));
  return db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Figma-Token, X-Review-Project, X-Review-Source, X-Recorded-At, X-Recorded-Date, X-Original-Filename, X-Duration-Seconds");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Auth check (images/static bot avatars + health exempt)
  const auth = req.headers.authorization;
  if (
    !url.pathname.startsWith("/images/") &&
    !url.pathname.startsWith(`${REVIEW_FIGMA_IMAGES_PUBLIC_PATH}/`) &&
    !url.pathname.startsWith(`${REVIEW_ATTACHMENTS_PUBLIC_PATH}/`) &&
    !url.pathname.startsWith("/bot/") &&
    url.pathname !== "/health" &&
    auth !== `Bearer ${API_KEY}`
  ) {
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
      const [claude, kimi, openai, codexQuota, openrouter, xai, grok] = await Promise.all([
        getClaudeUsage(),
        getKimiBalance(),
        getOpenAIUsage(),
        getOpenClawCodexQuota(),
        getOpenRouterCredits(),
        getXaiCredits(),
        getGrokSubscriptionUsage(),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ claude, kimi, openai, codexQuota, openrouter, xai, grok, timestamp: new Date().toISOString() }));
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
    } else if (url.pathname === "/usage/xai") {
      const xai = await getXaiCredits();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ xai, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/grok") {
      const grok = await getGrokSubscriptionUsage(url.searchParams.get("refresh") === "1");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ grok, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/codex") {
      const codexQuota = await getOpenClawCodexQuota();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ codexQuota, timestamp: new Date().toISOString() }));

    // --- Meeting Archive API ---
    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+\/audio$/) && req.method === "POST") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      if (!meetingId) {
        sendError(res, 400, "invalid meeting id");
        return;
      }
      try {
        let row = await receiveMeetingAudio(req, meetingId);
        if (url.searchParams.get("transcribe") !== "0") {
          row = queueMeetingTranscription(meetingId);
        }
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(serializeMeeting(req, row)));
      } catch (error) {
        if (!res.destroyed && !res.headersSent) {
          sendError(res, Number(error?.statusCode) || 500, error?.statusCode ? error.message : "meeting upload failed");
        }
      }

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+\/transcription\/retry$/) && req.method === "POST") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      if (!meetingId) {
        sendError(res, 400, "invalid meeting id");
        return;
      }
      const rawBody = await parseBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      try {
        const row = queueMeetingTranscription(meetingId, body, true);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify(serializeMeeting(req, row)));
      } catch (error) {
        sendError(res, Number(error?.statusCode) || 500, error.message || "failed to retry transcription");
      }

    } else if (url.pathname === "/api/meeting-summary-jobs/reconcile" && req.method === "POST") {
      try {
        sendJson(res, 200, await sillokSummaryReconciler.runOnce());
      } catch (error) {
        sendJson(res, Number(error?.statusCode) || 500, {
          error: error.message || "failed to reconcile summary jobs",
          error_code: error.code || "summary_reconcile_error",
        });
      }

    } else if (url.pathname === "/api/meeting-summary-jobs" && req.method === "GET") {
      try {
        const jobs = meetingSummaryJobService.listJobs({
          status: url.searchParams.get("status") || "pending",
          limit: url.searchParams.get("limit"),
        });
        sendJson(res, 200, { jobs });
      } catch (error) {
        sendJson(res, Number(error?.statusCode) || 500, {
          error: error.message || "failed to list summary jobs",
          error_code: error.code || "summary_job_error",
        });
      }

    } else if (url.pathname.match(/^\/api\/meeting-summary-jobs\/[a-zA-Z0-9_-]+$/) && req.method === "GET") {
      const jobId = url.pathname.split("/")[3];
      try {
        sendJson(res, 200, meetingSummaryJobService.getJob(jobId));
      } catch (error) {
        sendJson(res, Number(error?.statusCode) || 500, {
          error: error.message || "failed to get summary job",
          error_code: error.code || "summary_job_error",
        });
      }

    } else if (url.pathname.match(/^\/api\/meeting-summary-jobs\/[a-zA-Z0-9_-]+\/(attempt|dispatched|claim|result|fail|retry)$/) && req.method === "POST") {
      const [, , , jobId, action] = url.pathname.split("/");
      const rawBody = await parseBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      try {
        let result;
        if (action === "attempt") {
          result = meetingSummaryJobService.startAttempt(jobId);
        } else if (action === "dispatched") {
          result = meetingSummaryJobService.markDispatched(jobId, {
            attemptId: body.attempt_id,
            nonce: body.nonce,
            channelId: body.discord_channel_id,
            messageId: body.discord_message_id,
          });
        } else if (action === "claim") {
          result = meetingSummaryJobService.claimJob(jobId, {
            attemptId: body.attempt_id,
            nonce: body.nonce,
            agent: body.agent,
            schemaVersion: body.schema_version,
          });
        } else if (action === "result") {
          result = meetingSummaryJobService.completeJob(jobId, {
            attemptId: body.attempt_id,
            nonce: body.nonce,
            schemaVersion: body.schema_version,
            title: body.title,
            summary: body.summary,
            model: body.model,
            agent: body.agent,
            contextMode: body.context_mode,
          });
        } else if (action === "fail") {
          result = meetingSummaryJobService.failAttempt(jobId, {
            attemptId: body.attempt_id,
            nonce: body.nonce,
            errorCode: body.error_code,
            error: body.error,
            retryable: body.retryable !== false,
            nextAttemptAt: body.next_attempt_at || null,
          });
        } else {
          result = meetingSummaryJobService.retryJob(jobId);
        }
        sendJson(res, action === "attempt" ? 201 : 200, result);
      } catch (error) {
        sendJson(res, Number(error?.statusCode) || 500, {
          error: error.message || "summary job operation failed",
          error_code: error.code || "summary_job_error",
        });
      }

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+\/summary\/agent$/) && req.method === "POST") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      if (!meetingId) {
        sendError(res, 400, "invalid meeting id");
        return;
      }
      const rawBody = await parseBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      try {
        const job = meetingSummaryJobService.createJob(meetingId, {
          trigger: body.trigger || "manual",
          regenerate: body.regenerate === true,
        });
        sendJson(res, 202, job);
      } catch (error) {
        sendJson(res, Number(error?.statusCode) || 500, {
          error: error.message || "failed to create summary job",
          error_code: error.code || "summary_job_error",
        });
      }

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+\/summary\/retry$/) && req.method === "POST") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      if (!meetingId) {
        sendError(res, 400, "invalid meeting id");
        return;
      }
      try {
        const row = queueMeetingSummary(meetingId, true);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify(serializeMeeting(req, row)));
      } catch (error) {
        sendError(res, Number(error?.statusCode) || 500, error.message || "failed to retry summary");
      }

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+\/transcription$/) && req.method === "POST") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      if (!meetingId) {
        sendError(res, 400, "invalid meeting id");
        return;
      }
      const rawBody = await parseBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      try {
        const row = queueMeetingTranscription(meetingId, body, body.force === true);
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify(serializeMeeting(req, row)));
      } catch (error) {
        sendError(res, Number(error?.statusCode) || 500, error.message || "failed to queue transcription");
      }

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+\/transcription$/) && req.method === "GET") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      const row = meetingId ? db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId) : null;
      if (!row) {
        sendError(res, 404, "meeting not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeMeeting(req, row).transcription));

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+\/audio$/) && req.method === "DELETE") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      const row = meetingId ? db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId) : null;
      if (!row) {
        sendError(res, 404, "meeting not found");
        return;
      }
      if (["queued", "processing"].includes(row.transcription_status)) {
        sendError(res, 409, "audio cannot be deleted while transcription is active");
        return;
      }
      const filePath = getMeetingArchivePath(row.audio_path);
      if (filePath) {
        await fs.promises.rm(filePath, { force: true });
        await fs.promises.rmdir(path.dirname(filePath)).catch(() => {});
      }
      db.prepare("UPDATE meetings SET audio_deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(meetingId);
      const updated = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeMeeting(req, updated)));

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+\/audio$/) && req.method === "GET") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      const row = meetingId ? db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId) : null;
      if (!row) {
        sendError(res, 404, "meeting not found");
        return;
      }
      sendMeetingAudio(req, res, row);

    } else if (url.pathname === "/api/meetings" && req.method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
      const rows = db.prepare("SELECT * FROM meetings ORDER BY record_number DESC LIMIT ?").all(limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ meetings: rows.map(row => serializeMeeting(req, row)) }));

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+$/) && req.method === "GET") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      const row = meetingId ? db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId) : null;
      if (!row) {
        sendError(res, 404, "meeting not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeMeeting(req, row)));

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+$/) && req.method === "PATCH") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      const existing = meetingId ? db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId) : null;
      if (!existing) {
        sendError(res, 404, "meeting not found");
        return;
      }
      const rawBody = await parseBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const updates = {
        title: Object.prototype.hasOwnProperty.call(body, "title") ? normalizeOptionalText(body.title) : existing.title,
        titleSource: Object.prototype.hasOwnProperty.call(body, "title")
          ? (normalizeOptionalText(body.title) ? "user" : "default")
          : (existing.title_source || "default"),
        transcript: Object.prototype.hasOwnProperty.call(body, "transcript") ? normalizeOptionalText(body.transcript) : existing.transcript,
        speakerNames: Object.prototype.hasOwnProperty.call(body, "speaker_names")
          ? normalizeMeetingSpeakerNames(body.speaker_names)
          : parseMeetingJSON(existing.speaker_names_json, {}),
      };
      db.prepare("UPDATE meetings SET title=?, title_source=?, transcript=?, speaker_names_json=?, updated_at=datetime('now') WHERE id=?")
        .run(updates.title, updates.titleSource, updates.transcript, JSON.stringify(updates.speakerNames), meetingId);
      const row = db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeMeeting(req, row)));

    } else if (url.pathname.match(/^\/api\/meetings\/[a-zA-Z0-9_-]+$/) && req.method === "DELETE") {
      const meetingId = normalizeMeetingId(url.pathname.split("/")[3]);
      const existing = meetingId ? db.prepare("SELECT * FROM meetings WHERE id=?").get(meetingId) : null;
      if (!existing) {
        sendError(res, 404, "meeting not found");
        return;
      }
      if (
        ["queued", "processing"].includes(existing.transcription_status)
        || ["queued", "processing"].includes(existing.summary_status)
      ) {
        sendError(res, 409, "meeting cannot be deleted while processing is active");
        return;
      }
      const filePath = getMeetingArchivePath(existing.audio_path);
      if (filePath) {
        await fs.promises.rm(filePath, { force: true });
        await fs.promises.rmdir(path.dirname(filePath)).catch(() => {});
      }
      db.prepare("DELETE FROM meetings WHERE id=?").run(meetingId);
      res.writeHead(204);
      res.end();

    // --- Dependency Update API ---
    } else if (url.pathname === "/api/dependencies" && req.method === "GET") {
      const result = await scanDependencies({ forceRefresh: url.searchParams.get("refresh") === "1" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

    // --- Today Task Queue API ---
    } else if (url.pathname === "/api/today-queue/runs" && req.method === "GET") {
      try {
        const result = todayQueueHistoryService.listRuns({
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit"),
          projectId: url.searchParams.get("project_id"),
          status: url.searchParams.get("status"),
        });
        sendJson(res, 200, result);
      } catch (error) {
        if (error?.statusCode === 400) {
          sendError(res, 400, error.message);
          return;
        }
        throw error;
      }

    } else if (url.pathname.match(/^\/api\/today-queue\/runs\/[^/]+$/) && req.method === "GET") {
      let runId;
      try {
        runId = decodeURIComponent(url.pathname.split("/")[4]);
      } catch {
        sendError(res, 400, "run_id is invalid");
        return;
      }
      try {
        const result = todayQueueHistoryService.getRun(runId);
        if (!result) {
          sendError(res, 404, "queue run not found");
          return;
        }
        sendJson(res, 200, result);
      } catch (error) {
        if (error?.statusCode === 400) {
          sendError(res, 400, error.message);
          return;
        }
        throw error;
      }

    } else if (url.pathname === "/api/today-queue/status" && req.method === "GET") {
      const projectValidation = validateTodayQueueProjectId(url.searchParams.get("project_id"));
      if (projectValidation.error) {
        sendError(res, projectValidation.status, projectValidation.error);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(buildTodayQueueStatus(projectValidation.projectId)));

    } else if ((url.pathname === "/api/today-queue/start" || url.pathname === "/api/today-queue/next") && req.method === "POST") {
      const body = await parseBody(req);
      const payload = body ? JSON.parse(body) : {};
      const projectValidation = validateTodayQueueProjectId(payload.project_id);
      if (projectValidation.error) {
        sendError(res, projectValidation.status, projectValidation.error);
        return;
      }
      const requestedBotKey = normalizeOptionalText(payload.bot_key || payload.target_bot_key);
      const action = url.pathname.endsWith("/start") ? "start" : "next";
      const result = await dispatchNextTodayQueueItem({
        projectId: projectValidation.projectId,
        botKey: requestedBotKey || null,
        startedBy: `api:${action}`,
      });
      const event = {
        action,
        projectId: result.project_id,
        started: result.started,
        reason: result.reason,
        itemId: result.dispatch?.item_id || result.item?.id || null,
      };
      broadcastSSE("today-queue", event);
      if (result.started || result.reason === "missing_discord_target" || result.reason === "dispatch_failed") {
        broadcastSSE("items-changed", { action: "today-queue", projectId: result.project_id, reason: result.reason });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

    } else if (url.pathname === "/api/today-queue/stop" && req.method === "POST") {
      const body = await parseBody(req);
      const payload = body ? JSON.parse(body) : {};
      const projectValidation = validateTodayQueueProjectId(payload.project_id);
      if (projectValidation.error) {
        sendError(res, projectValidation.status, projectValidation.error);
        return;
      }
      const result = stopTodayQueue({ projectId: projectValidation.projectId });
      broadcastSSE("today-queue", { action: "stop", projectId: result.project_id, stopped: result.stopped, reason: result.reason });
      if (result.stopped > 0) broadcastSSE("items-changed", { action: "today-queue-stop", projectId: result.project_id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

    } else if (url.pathname.match(/^\/api\/projects\/\d+\/today-queue\/order$/) && req.method === "PUT") {
      const projectId = parseInt(url.pathname.split("/")[3]);
      const body = await parseBody(req);
      const payload = body ? JSON.parse(body) : {};
      const result = todayQueueService.reorderProject({ projectId, itemIds: payload.item_ids });
      if (!result.ok) {
        res.writeHead(result.status || 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }
      broadcastSSE("items-changed", { action: "today-queue-reordered", projectId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

    } else if (url.pathname.match(/^\/api\/projects\/\d+\/today-queue\/items$/) && req.method === "POST") {
      const projectId = parseInt(url.pathname.split("/")[3]);
      const body = await parseBody(req);
      const payload = body ? JSON.parse(body) : {};
      const itemId = Number(payload.item_id);
      const beforeItemId = payload.before_item_id == null ? null : Number(payload.before_item_id);
      const afterItemId = payload.after_item_id == null ? null : Number(payload.after_item_id);
      if (!Number.isInteger(itemId) || (beforeItemId !== null && !Number.isInteger(beforeItemId)) || (afterItemId !== null && !Number.isInteger(afterItemId))) {
        sendError(res, 400, "item ids must be integers");
        return;
      }
      const result = todayQueueService.placeItem({ projectId, itemId, beforeItemId, afterItemId });
      if (!result.ok) {
        res.writeHead(result.status || 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }
      broadcastSSE("items-changed", { action: "today-queue-item-placed", projectId, itemId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

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
          `INSERT INTO projects (name, emoji, sort_order)
           VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM projects))
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
      const projects = db.prepare("SELECT * FROM projects WHERE COALESCE(status,'active') = 'active' ORDER BY sort_order, id").all();
      const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all();
      const activeItems = db.prepare("SELECT * FROM items WHERE status IN ('todo','in_progress','done','review') ORDER BY sort_order, id").all();

      const result = projects.map(p => {
        const projCats = categories.filter(c => c.project_id === p.id);
        const projItems = activeItems.filter(i => i.project_id === p.id);

        return {
          id: p.id,
          emoji: p.emoji,
          name: p.name,
          color: p.color || null,
          discord_channel_id: p.discord_channel_id || null,
          discord_thread_id: p.discord_thread_id || null,
          default_ai_bot_key: normalizeTodoQueueBotKey(p.default_ai_bot_key || DEFAULT_TODO_QUEUE_BOT_KEY),
          items: projItems
            .filter(i => i.category_id === null)
            .map(serializeTodoItem),
          categories: projCats.map(c => ({
            id: c.id,
            name: c.name,
            items: projItems
              .filter(i => i.category_id === c.id)
              .map(serializeTodoItem),
          })),
        };
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

    // POST /api/projects — 프로젝트 생성
    } else if (url.pathname === "/api/projects" && req.method === "POST") {
      const body = await parseBody(req);
      const { emoji, name, default_ai_bot_key } = JSON.parse(body);
      if (!name) { sendError(res, 400, "name required"); return; }
      const botKey = normalizeTodoQueueBotKey(default_ai_bot_key || DEFAULT_TODO_QUEUE_BOT_KEY);

      const row = db.prepare(
        `INSERT INTO projects (name, emoji, default_ai_bot_key, sort_order)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM projects))
         RETURNING *`
      ).get(name, emoji || '📌', botKey);
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
      for (const key of ["emoji", "name", "status", "color", "discord_channel_id", "discord_thread_id", "default_ai_bot_key"]) {
        if (updates[key] !== undefined) {
          fields.push(`${key}=?`);
          values.push(key === "default_ai_bot_key" ? normalizeTodoQueueBotKey(updates[key]) : updates[key]);
        }
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
      const row = db.transaction(() => {
        const created = db.prepare(
          `INSERT INTO items (project_id, category_id, title, content, is_today, owner, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM items WHERE project_id=?))
           RETURNING *`
        ).get(projectId, category_id || null, title, content || null, is_today ? 1 : 0, owner || null, projectId);
        todayQueueService.reconcileItem(null, created);
        return db.prepare("SELECT * FROM items WHERE id=?").get(created.id);
      })();
      broadcastSSE("item-created", { id: row.id, projectId });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // PATCH /api/items/:id — 아이템 수정
    } else if (url.pathname.match(/^\/api\/items\/\d+$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/").pop());
      const body = await parseBody(req);
      const updates = JSON.parse(body);
      const before = db.prepare("SELECT * FROM items WHERE id=?").get(id);
      if (!before) { sendError(res, 404, "item not found"); return; }
      const proposed = {
        ...before,
        ...updates,
        is_today: updates.is_today === undefined ? before.is_today : (updates.is_today ? 1 : 0),
      };
      if (before.status === "in_progress" && todayQueueService.isQueueMember(before)
          && (!todayQueueService.isQueueMember(proposed) || proposed.project_id !== before.project_id)) {
        sendError(res, 409, "stop the running queue item before removing or moving it");
        return;
      }
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
      const row = db.transaction(() => {
        db.prepare(`UPDATE items SET ${fields.join(",")} WHERE id=?`).run(...values);
        const updated = db.prepare("SELECT * FROM items WHERE id=?").get(id);
        todayQueueService.reconcileItem(before, updated);
        return db.prepare("SELECT * FROM items WHERE id=?").get(id);
      })();
      broadcastSSE("item-updated", { id, projectId: row?.project_id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // PATCH /api/items/:id/owner — 아이템 담당자 전용 수정
    } else if (url.pathname.match(/^\/api\/items\/\d+\/owner$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/")[3]);
      const body = await parseBody(req);
      const { owner } = JSON.parse(body);
      const before = db.prepare("SELECT * FROM items WHERE id=?").get(id);
      if (!before) { sendError(res, 404, "item not found"); return; }
      const proposed = { ...before, owner: owner ?? null };
      if (before.status === "in_progress" && todayQueueService.isQueueMember(before) && !todayQueueService.isQueueMember(proposed)) {
        sendError(res, 409, "stop the running queue item before changing its owner");
        return;
      }
      const row = db.transaction(() => {
        db.prepare("UPDATE items SET owner=? WHERE id=?").run(owner ?? null, id);
        const updated = db.prepare("SELECT * FROM items WHERE id=?").get(id);
        todayQueueService.reconcileItem(before, updated);
        return db.prepare("SELECT * FROM items WHERE id=?").get(id);
      })();
      broadcastSSE("item-updated", { id, projectId: row?.project_id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // DELETE /api/items/:id — 아이템 삭제
    } else if (url.pathname.match(/^\/api\/items\/\d+$/) && req.method === "DELETE") {
      const id = parseInt(url.pathname.split("/").pop());
      const item = db.prepare("SELECT * FROM items WHERE id=?").get(id);
      if (!item) { sendError(res, 404, "item not found"); return; }
      if (item.status === "in_progress" && todayQueueService.isQueueMember(item)) {
        sendError(res, 409, "stop the running queue item before deleting it");
        return;
      }
      db.transaction(() => {
        db.prepare("DELETE FROM items WHERE id=?").run(id);
        todayQueueService.removeDeletedItem(item);
      })();
      broadcastSSE("item-deleted", { id, projectId: item.project_id });
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
      filter += " AND status<>'in_progress'";
      const affectedProjectIds = db.prepare(`SELECT DISTINCT project_id FROM items WHERE ${filter}`).all().map(row => row.project_id);
      const info = db.transaction(() => {
        const updated = db.prepare(`UPDATE items SET is_today=0, today_queue_order=NULL WHERE ${filter}`).run();
        affectedProjectIds.forEach(projectId => todayQueueService.normalizeProjectOrder(projectId));
        return updated;
      })();
      broadcastSSE("items-changed", { action: "untoday-all" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cleared: info.changes }));

    // POST /api/projects/:id/clear-done — 완료 항목 아카이브
    } else if (url.pathname.match(/^\/api\/projects\/\d+\/clear-done$/) && req.method === "POST") {
      const projectId = parseInt(url.pathname.split("/")[3]);
      const done = db.prepare("SELECT COUNT(*) as cnt FROM items WHERE project_id=? AND status='done'").get(projectId);
      db.transaction(() => {
        db.prepare("UPDATE items SET status='archived', today_queue_order=NULL, updated_at=datetime('now') WHERE project_id=? AND status='done'").run(projectId);
        todayQueueService.normalizeProjectOrder(projectId);
      })();
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
      const AGENT_WORKSPACES = {
        bbang: ".openclaw/workspace",
        pang: ".openclaw/workspace-pang",
        boong: ".openclaw/workspace-boong",
        ob: ".openclaw/workspace-ob",
      };
      const wsRel = AGENT_WORKSPACES[agent] || AGENT_WORKSPACES.bbang;
      const basePath = path.join(require("os").homedir(), wsRel);
      const filePath = path.join(basePath, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        res.writeHead(200, JSON_HEADER);
        res.end(JSON.stringify({ content }));
      } catch (e) {
        res.writeHead(404, JSON_HEADER);
        res.end(JSON.stringify({ error: "File not found" }));
      }

    // POST /api/assign — AI에게 item 단위 작업 지시서 dispatch
    } else if (url.pathname === "/api/assign" && req.method === "POST") {
      const body = await parseBody(req);
      const payload = JSON.parse(body || "{}");
      const { item_ids } = payload;
      if (!item_ids || !item_ids.length) { sendError(res, 400, "item_ids required"); return; }

      const botKey = normalizeOptionalText(payload.bot_key || payload.target_bot_key) || DEFAULT_TODO_QUEUE_BOT_KEY;
      const itemStmt = db.prepare(`
        SELECT i.*,
               p.name as project_name,
               p.emoji as project_emoji,
               p.discord_channel_id,
               p.discord_thread_id,
               c.name as category_name
          FROM items i
          JOIN projects p ON i.project_id = p.id
          LEFT JOIN categories c ON i.category_id = c.id
         WHERE i.id=?
      `);
      const items = item_ids
        .map(id => itemStmt.get(id))
        .filter(i => i && i.status !== 'review' && i.status !== 'done' && i.status !== 'archived');

      const assigned = [];
      const failed = [];
      const skipped = [];
      for (const item of items) {
        if (!item.discord_thread_id && !item.discord_channel_id) {
          const reason = `item #${item.id} project has no Discord channel/thread mapping`;
          recordTodoDispatchFailure(item.id, reason);
          skipped.push({ item_id: item.id, reason });
          continue;
        }
        try {
          assigned.push(await dispatchTodoItemToDiscord(item, { botKey }));
        } catch (e) {
          console.error(`[assign] dispatch error item #${item.id}:`, e.message);
          recordTodoDispatchFailure(item.id, e);
          failed.push({ item_id: item.id, error: e.message });
        }
      }

      broadcastSSE("items-changed", { action: "assign" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        assigned: assigned.length,
        requested: item_ids.length,
        eligible: items.length,
        failed: failed.length,
        skipped: skipped.length,
        dispatches: assigned,
        errors: failed,
        skips: skipped,
      }));

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

    // /api/review/figma-images — df-web-review-kit endpoint store
    } else if (url.pathname === "/api/review/figma-images" || url.pathname.startsWith("/api/review/figma-images/")) {
      await handleReviewFigmaImagesRequest(req, res, url);
      return;

    // /api/review/review-attachments — df-web-review-kit attachment upload
    } else if (url.pathname === "/api/review/review-attachments" || url.pathname.startsWith("/api/review/review-attachments/")) {
      await handleReviewAttachmentsRequest(req, res, url);
      return;

    // GET /review-figma-images/* — static Figma review assets
    } else if (url.pathname.startsWith(`${REVIEW_FIGMA_IMAGES_PUBLIC_PATH}/`) && req.method === "GET") {
      sendReviewFigmaImageAsset(res, url);
      return;

    // GET /review-attachments/* — static review attachments
    } else if (url.pathname.startsWith(`${REVIEW_ATTACHMENTS_PUBLIC_PATH}/`) && req.method === "GET") {
      sendReviewAttachmentAsset(res, url);
      return;

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
          const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
          const imagePath = path.join(__dirname, "images", id);
          sharp(imageData)
            .rotate() // apply EXIF orientation before Discord upload / face matching
            .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toBuffer()
            .then(processed => {
              fs.writeFileSync(imagePath, processed);
              res.writeHead(201, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ id, url: `/images/${id}`, size: processed.length, normalized: true }));
            })
            .catch(() => {
              fs.writeFileSync(imagePath, imageData);
              res.writeHead(201, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ id, url: `/images/${id}`, size: imageData.length, normalized: false }));
            });
        } else {
          // raw binary upload — sharp로 리사이즈 + JPEG 변환
          const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
          const imagePath = path.join(__dirname, "images", id);
          sharp(buffer)
            .rotate() // apply EXIF orientation before storage
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

    // GET /bot/* — static bot profile avatars for voice UI
    } else if (url.pathname.startsWith("/bot/") && req.method === "GET") {
      const filename = path.basename(url.pathname.replace("/bot/", ""));
      const filePath = path.join(__dirname, "bot", filename);
      if (!fs.existsSync(filePath)) { sendError(res, 404, "not found"); return; }
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
      const mime = mimeTypes[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
      fs.createReadStream(filePath).pipe(res);
      return;

    } else if (url.pathname === "/api/voice-usage" && req.method === "GET") {
      // ElevenLabs 구독/사용량 — character_count, character_limit 기준 퍼센트 반환.
      try {
        const elevenKey = process.env.ELEVENLABS_API_KEY;
        if (!elevenKey) {
          sendError(res, 500, "ELEVENLABS_API_KEY not set");
          return;
        }
        const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
          headers: { "xi-api-key": elevenKey },
        });
        if (!r.ok) {
          sendError(res, r.status, `elevenlabs subscription error ${r.status}`);
          return;
        }
        const j = await r.json();
        const used = Number(j.character_count) || 0;
        const limit = Number(j.character_limit) || 0;
        const remaining = Math.max(0, limit - used);
        const usedPct = limit > 0 ? (used / limit) * 100 : 0;
        const remainingPct = limit > 0 ? (remaining / limit) * 100 : 0;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          used,
          limit,
          remaining,
          usedPct: Math.round(usedPct * 10) / 10,
          remainingPct: Math.round(remainingPct * 10) / 10,
          nextResetUnix: j.next_character_count_reset_unix || null,
          tier: j.tier || null,
        }));
      } catch (e) {
        sendError(res, 500, `voice-usage error: ${e.message}`);
      }

    } else if (url.pathname === "/api/voice-config" && req.method === "GET") {
      // voice-config.json을 매 요청마다 읽음 — 파일만 저장하면 즉시 반영, 서버 재기동 불필요.
      const cfgPath = path.join(__dirname, "voice-config.json");
      let cfg = {};
      try {
        const raw = fs.readFileSync(cfgPath, "utf8");
        // JSONC — //, /* */ 주석 허용. 문자열 안의 슬래시는 보존.
        const stripped = raw
          .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str || "");
        cfg = JSON.parse(stripped);
      } catch (e) {
        console.warn("[voice-config] read failed, using defaults:", e.message);
      }
      const settings = cfg.voiceSettings || {};
      const normalizeVoiceSettings = (raw, fallback = {}) => {
        const source = raw && typeof raw === "object" ? raw : {};
        return {
          stability: typeof source.stability === "number" ? source.stability : (typeof fallback.stability === "number" ? fallback.stability : 0.5),
          similarityBoost: typeof source.similarityBoost === "number" ? source.similarityBoost : (typeof fallback.similarityBoost === "number" ? fallback.similarityBoost : 0.75),
          style: typeof source.style === "number" ? source.style : (typeof fallback.style === "number" ? fallback.style : 0),
          speed: typeof source.speed === "number" ? source.speed : (typeof fallback.speed === "number" ? fallback.speed : 1.0),
        };
      };
      const normalizedSettings = normalizeVoiceSettings(settings);
      const configUrl = (value) => {
        if (typeof value !== "string" || value.trim() === "") return undefined;
        return value;
      };
      const bots = cfg.bots && typeof cfg.bots === "object"
        ? Object.fromEntries(Object.entries(cfg.bots).map(([key, raw]) => {
            const bot = raw && typeof raw === "object" ? raw : {};
            return [key, {
              displayName: typeof bot.displayName === "string" ? bot.displayName : undefined,
              discordUserId: typeof bot.discordUserId === "string" ? bot.discordUserId : undefined,
              voiceId: typeof bot.voiceId === "string" ? bot.voiceId : undefined,
              gender: typeof bot.gender === "string" ? bot.gender : undefined,
              color: typeof bot.color === "string" ? bot.color : undefined,
              avatarUrl: configUrl(bot.avatarUrl),
              ttsModel: typeof bot.ttsModel === "string" ? bot.ttsModel : undefined,
              voiceSettings: normalizeVoiceSettings(bot.voiceSettings, normalizedSettings),
            }];
          }))
        : undefined;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        voiceId: cfg.voiceId || "NaQdbkW5gNZD8wfwXeTV",
        ttsModel: cfg.ttsModel || "eleven_v3",
        sttModel: cfg.sttModel || "scribe_v1",
        voiceSettings: normalizedSettings,
        bridgeTimeoutMs: typeof cfg.bridgeTimeoutMs === "number" ? cfg.bridgeTimeoutMs : 90000,
        iosWaitingTimeoutSec: typeof cfg.iosWaitingTimeoutSec === "number" ? cfg.iosWaitingTimeoutSec : 95,
        emotionEmojiSize: typeof cfg.emotionEmojiSize === "number" ? cfg.emotionEmojiSize : 30,
        emotionEmojiMap: cfg.emotionEmojiMap && typeof cfg.emotionEmojiMap === "object" ? cfg.emotionEmojiMap : undefined,
        bots,
      }));

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

// Today Queue bridge — DUDU_RESULT_V1 marker 감지 → review 전환 → next dispatch
startTodayQueueBridge();

// Voice bridge — bb-private [voice] 메시지 감지 → 빵빵 답변 Ably publish
try {
  require("./voice-bridge").start();
} catch (e) {
  console.error("[voice-bridge] failed to start:", e.message);
}
