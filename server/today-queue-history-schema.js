const RUN_STATUSES = ["running", "completed", "stopped", "failed"];
const TASK_RUN_STATUSES = [
  "pending",
  "active",
  "review",
  "completed",
  "failed",
  "stopped",
  "skipped",
];

function tableColumns(db, tableName) {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name),
  );
}

function addColumn(db, tableName, columnName, definition) {
  if (tableColumns(db, tableName).has(columnName)) return false;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  return true;
}

function migrateTodayQueueHistorySchema(db) {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS today_queue_runs (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        project_emoji TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('running', 'completed', 'stopped', 'failed')
        ),
        started_by TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        stopped_at TEXT,
        failure_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS today_queue_task_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES today_queue_runs(id),
        project_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        category_id INTEGER,
        sequence_index INTEGER NOT NULL CHECK (sequence_index > 0),
        attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'active', 'review', 'completed', 'failed', 'stopped', 'skipped')
        ),
        item_title TEXT NOT NULL,
        item_content TEXT,
        category_name TEXT,
        issue_url TEXT,
        bot_key TEXT,
        bot_user_id TEXT,
        dispatch_nonce TEXT,
        dispatch_channel_id TEXT,
        dispatch_message_id TEXT,
        dispatch_message_url TEXT,
        result_message_id TEXT,
        result_message_url TEXT,
        git_commit TEXT,
        queued_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        stopped_at TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(run_id, item_id, attempt)
      );
    `);

    addColumn(db, "projects", "current_run_id", "TEXT");
    addColumn(db, "items", "issue_url", "TEXT");
    addColumn(db, "items", "current_task_run_id", "TEXT");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_today_queue_runs_project_started
        ON today_queue_runs(project_id, started_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_today_queue_runs_project_running
        ON today_queue_runs(project_id)
        WHERE status='running';
      CREATE INDEX IF NOT EXISTS idx_today_queue_task_runs_run_sequence
        ON today_queue_task_runs(run_id, sequence_index, attempt);
      CREATE INDEX IF NOT EXISTS idx_today_queue_task_runs_item
        ON today_queue_task_runs(item_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_today_queue_task_runs_project_created
        ON today_queue_task_runs(project_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_current_run
        ON projects(current_run_id)
        WHERE current_run_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_current_task_run
        ON items(current_task_run_id)
        WHERE current_task_run_id IS NOT NULL;
    `);
  });

  migrate();
}

module.exports = {
  RUN_STATUSES,
  TASK_RUN_STATUSES,
  migrateTodayQueueHistorySchema,
};
