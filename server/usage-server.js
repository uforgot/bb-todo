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
          items: projItems
            .filter(i => i.category_id === null)
            .map(i => ({ id: i.id, title: i.title, content: i.content, status: i.status, is_today: !!i.is_today })),
          categories: projCats.map(c => ({
            id: c.id,
            name: c.name,
            items: projItems
              .filter(i => i.category_id === c.id)
              .map(i => ({ id: i.id, title: i.title, content: i.content, status: i.status, is_today: !!i.is_today })),
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
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // PATCH /api/projects/:id — 프로젝트 수정
    } else if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/").pop());
      const body = await parseBody(req);
      const updates = JSON.parse(body);
      const fields = [];
      const values = [];
      for (const key of ["emoji", "name", "priority", "status", "color"]) {
        if (updates[key] !== undefined) { fields.push(`${key}=?`); values.push(updates[key]); }
      }
      if (fields.length === 0) { sendError(res, 400, "no fields to update"); return; }
      values.push(id);
      db.prepare(`UPDATE projects SET ${fields.join(",")} WHERE id=?`).run(...values);
      const row = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));

    // DELETE /api/projects/:id — 프로젝트 삭제 (CASCADE)
    } else if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === "DELETE") {
      const id = parseInt(url.pathname.split("/").pop());
      db.prepare("DELETE FROM items WHERE project_id=?").run(id);
      db.prepare("DELETE FROM categories WHERE project_id=?").run(id);
      db.prepare("DELETE FROM projects WHERE id=?").run(id);
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
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // DELETE /api/categories/:id — 카테고리 삭제 (아이템은 루트로 이동)
    } else if (url.pathname.match(/^\/api\/categories\/\d+$/) && req.method === "DELETE") {
      const catId = parseInt(url.pathname.split("/")[3]);
      db.prepare("UPDATE items SET category_id=NULL WHERE category_id=?").run(catId);
      db.prepare("DELETE FROM categories WHERE id=?").run(catId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Category deleted, items moved to root" }));

    // POST /api/projects/:id/items — 아이템 생성
    } else if (url.pathname.match(/^\/api\/projects\/\d+\/items$/) && req.method === "POST") {
      const projectId = parseInt(url.pathname.split("/")[3]);
      const body = await parseBody(req);
      const { title, content, category_id, is_today } = JSON.parse(body);
      if (!title) { sendError(res, 400, "title required"); return; }
      const row = db.prepare(
        `INSERT INTO items (project_id, category_id, title, content, is_today, sort_order)
         VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM items WHERE project_id=?))
         RETURNING *`
      ).get(projectId, category_id || null, title, content || null, is_today ? 1 : 0, projectId);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // PATCH /api/items/:id — 아이템 수정
    } else if (url.pathname.match(/^\/api\/items\/\d+$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/").pop());
      const body = await parseBody(req);
      const updates = JSON.parse(body);
      const fields = [];
      const values = [];
      for (const key of ["title", "content", "status", "is_today", "category_id"]) {
        if (updates[key] !== undefined) {
          fields.push(`${key}=?`);
          values.push(key === "is_today" ? (updates[key] ? 1 : 0) : updates[key]);
        }
      }
      if (updates.status === "done") { fields.push("updated_at=datetime('now')"); }
      if (fields.length === 0) { sendError(res, 400, "no fields to update"); return; }
      values.push(id);
      db.prepare(`UPDATE items SET ${fields.join(",")} WHERE id=?`).run(...values);
      const row = db.prepare("SELECT * FROM items WHERE id=?").get(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));

    // DELETE /api/items/:id — 아이템 삭제
    } else if (url.pathname.match(/^\/api\/items\/\d+$/) && req.method === "DELETE") {
      const id = parseInt(url.pathname.split("/").pop());
      db.prepare("DELETE FROM items WHERE id=?").run(id);
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
