const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createTodayQueueService } = require("./today-queue-service");
const { migrateTodayQueueHistorySchema } = require("./today-queue-history-schema");

function createLegacyDb(filename = ":memory:") {
  const db = new Database(filename);
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      sort_order INTEGER DEFAULT 0,
      discord_channel_id TEXT,
      discord_thread_id TEXT,
      default_ai_bot_key TEXT
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      category_id INTEGER,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      sort_order INTEGER DEFAULT 0,
      is_today INTEGER DEFAULT 0,
      today_queue_order INTEGER,
      owner TEXT,
      dispatch_nonce TEXT,
      dispatch_started_at TEXT,
      dispatch_message_url TEXT,
      dispatch_attempt_count INTEGER DEFAULT 0,
      dispatch_last_error TEXT
    );
    INSERT INTO projects (
      id, name, emoji, sort_order, discord_channel_id, default_ai_bot_key
    ) VALUES (1, 'Legacy project', '🕰️', 1, 'channel-1', 'bbangbbang');
    INSERT INTO items (
      id, project_id, status, title, content, sort_order, is_today,
      today_queue_order, owner, dispatch_nonce, dispatch_started_at,
      dispatch_message_url, dispatch_attempt_count
    ) VALUES (
      101, 1, 'in_progress', 'Legacy mutable title', 'Legacy content', 1, 1,
      1, 'AI', 'legacy-nonce', '2026-07-20 01:02:03',
      'https://discord.com/channels/legacy', 4
    );
  `);
  return db;
}

function createQueueService(db) {
  return createTodayQueueService({
    db,
    serializeTodoItem: item => ({
      id: item.id,
      title: item.title,
      content: item.content,
      status: item.status,
    }),
    normalizeBotKey: key => key,
    defaultBotKey: "bbangbbang",
    dispatchItem: async () => ({ item_id: 101 }),
    recordFailure: () => {},
  });
}

function columns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name);
}

function indexNames(db, tableName) {
  return db.prepare(`PRAGMA index_list(${tableName})`).all().map(index => index.name);
}

test("migrates a legacy database without inventing historical runs", () => {
  const db = createLegacyDb();

  migrateTodayQueueHistorySchema(db);
  migrateTodayQueueHistorySchema(db);

  assert.ok(columns(db, "projects").includes("current_run_id"));
  assert.ok(columns(db, "items").includes("issue_url"));
  assert.ok(columns(db, "items").includes("current_task_run_id"));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM today_queue_runs").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM today_queue_task_runs").get().count, 0);
  assert.equal(db.prepare("SELECT current_run_id FROM projects WHERE id=1").get().current_run_id, null);
  assert.equal(db.prepare("SELECT current_task_run_id FROM items WHERE id=101").get().current_task_run_id, null);
  assert.equal(db.prepare("SELECT dispatch_nonce FROM items WHERE id=101").get().dispatch_nonce, "legacy-nonce");

  assert.ok(indexNames(db, "today_queue_runs").includes("idx_today_queue_runs_project_running"));
  assert.ok(indexNames(db, "today_queue_task_runs").includes("idx_today_queue_task_runs_run_sequence"));
  db.close();
});

test("keeps the existing queue status contract working after migration", () => {
  const db = createLegacyDb();
  migrateTodayQueueHistorySchema(db);
  const service = createQueueService(db);
  service.initializeOrder();

  const status = service.buildStatus({ projectId: 1 });
  assert.equal(status.running, true);
  assert.equal(status.active[0].id, 101);
  assert.equal(status.projects[0].items[0].title, "Legacy mutable title");
  assert.equal(Object.hasOwn(status.projects[0], "current_run_id"), false);
  db.close();
});

test("enforces run and task-run status domains and positive sequence fields", () => {
  const db = createLegacyDb();
  migrateTodayQueueHistorySchema(db);

  assert.throws(() => db.prepare(`
    INSERT INTO today_queue_runs (id, project_id, project_name, status)
    VALUES ('bad-run', 1, 'Legacy project', 'paused')
  `).run(), /CHECK constraint failed/);

  db.prepare(`
    INSERT INTO today_queue_runs (id, project_id, project_name, status)
    VALUES ('run-1', 1, 'Legacy project', 'running')
  `).run();

  assert.throws(() => db.prepare(`
    INSERT INTO today_queue_task_runs (
      id, run_id, project_id, item_id, sequence_index, attempt, status, item_title
    ) VALUES ('bad-task', 'run-1', 1, 101, 1, 1, 'paused', 'Snapshot')
  `).run(), /CHECK constraint failed/);
  assert.throws(() => db.prepare(`
    INSERT INTO today_queue_task_runs (
      id, run_id, project_id, item_id, sequence_index, attempt, status, item_title
    ) VALUES ('bad-sequence', 'run-1', 1, 101, 0, 1, 'pending', 'Snapshot')
  `).run(), /CHECK constraint failed/);
  assert.throws(() => db.prepare(`
    INSERT INTO today_queue_runs (id, project_id, project_name, status)
    VALUES ('run-2', 1, 'Legacy project', 'running')
  `).run(), /UNIQUE constraint failed/);
  db.close();
});

test("appends retry attempts without overwriting prior snapshots", () => {
  const db = createLegacyDb();
  migrateTodayQueueHistorySchema(db);

  db.prepare(`
    INSERT INTO today_queue_runs (
      id, project_id, project_name, project_emoji, status, started_by
    ) VALUES ('run-1', 1, 'Legacy project', '🕰️', 'running', 'listener')
  `).run();
  db.prepare(`
    INSERT INTO today_queue_task_runs (
      id, run_id, project_id, item_id, sequence_index, attempt, status,
      item_title, item_content, issue_url, bot_key, dispatch_nonce
    ) VALUES (
      'task-1-attempt-1', 'run-1', 1, 101, 1, 1, 'failed',
      'Snapshot title v1', 'Snapshot content v1', 'https://example.com/issues/101',
      'bbangbbang', 'nonce-1'
    )
  `).run();

  db.prepare(`
    UPDATE items
       SET title='Mutable title v2', content='Mutable content v2', issue_url='https://example.com/issues/changed'
     WHERE id=101
  `).run();
  db.prepare(`
    INSERT INTO today_queue_task_runs (
      id, run_id, project_id, item_id, sequence_index, attempt, status,
      item_title, item_content, issue_url, bot_key, dispatch_nonce
    ) VALUES (
      'task-1-attempt-2', 'run-1', 1, 101, 1, 2, 'active',
      'Mutable title v2', 'Mutable content v2', 'https://example.com/issues/changed',
      'bbangbbang', 'nonce-2'
    )
  `).run();
  db.prepare("UPDATE projects SET current_run_id='run-1' WHERE id=1").run();
  db.prepare("UPDATE items SET current_task_run_id='task-1-attempt-2' WHERE id=101").run();

  const attempts = db.prepare(`
    SELECT id, attempt, item_title, item_content, issue_url, dispatch_nonce
      FROM today_queue_task_runs
     WHERE run_id='run-1'
     ORDER BY attempt
  `).all();
  assert.deepEqual(attempts, [
    {
      id: "task-1-attempt-1",
      attempt: 1,
      item_title: "Snapshot title v1",
      item_content: "Snapshot content v1",
      issue_url: "https://example.com/issues/101",
      dispatch_nonce: "nonce-1",
    },
    {
      id: "task-1-attempt-2",
      attempt: 2,
      item_title: "Mutable title v2",
      item_content: "Mutable content v2",
      issue_url: "https://example.com/issues/changed",
      dispatch_nonce: "nonce-2",
    },
  ]);
  assert.throws(() => db.prepare(`
    INSERT INTO today_queue_task_runs (
      id, run_id, project_id, item_id, sequence_index, attempt, status, item_title
    ) VALUES ('duplicate', 'run-1', 1, 101, 1, 1, 'pending', 'Duplicate')
  `).run(), /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT current_run_id FROM projects WHERE id=1").get().current_run_id, "run-1");
  assert.equal(db.prepare("SELECT current_task_run_id FROM items WHERE id=101").get().current_task_run_id, "task-1-attempt-2");
  db.close();
});

test("persists current-run linkage across a database reopen", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-todo-history-"));
  const filename = path.join(tempDir, "legacy.db");
  let db = createLegacyDb(filename);
  migrateTodayQueueHistorySchema(db);
  db.prepare(`
    INSERT INTO today_queue_runs (id, project_id, project_name, status)
    VALUES ('run-recoverable', 1, 'Legacy project', 'running')
  `).run();
  db.prepare(`
    INSERT INTO today_queue_task_runs (
      id, run_id, project_id, item_id, sequence_index, status, item_title
    ) VALUES ('task-recoverable', 'run-recoverable', 1, 101, 1, 'active', 'Snapshot')
  `).run();
  db.prepare("UPDATE projects SET current_run_id='run-recoverable' WHERE id=1").run();
  db.prepare("UPDATE items SET current_task_run_id='task-recoverable' WHERE id=101").run();
  db.close();

  db = new Database(filename);
  assert.equal(db.prepare("SELECT current_run_id FROM projects WHERE id=1").get().current_run_id, "run-recoverable");
  assert.equal(db.prepare("SELECT current_task_run_id FROM items WHERE id=101").get().current_task_run_id, "task-recoverable");
  assert.equal(db.prepare("SELECT status FROM today_queue_runs WHERE id='run-recoverable'").get().status, "running");
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
