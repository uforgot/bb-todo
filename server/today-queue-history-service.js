const { RUN_STATUSES } = require("./today-queue-history-schema");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CURSOR_VERSION = 1;
const SQLITE_UTC_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

class TodayQueueHistoryInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "TodayQueueHistoryInputError";
    this.statusCode = 400;
  }
}

function parseUtcTimestamp(value) {
  if (!value) return null;
  const normalized = SQLITE_UTC_PATTERN.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function durationMs(run, now) {
  const startedAt = parseUtcTimestamp(run.started_at);
  if (startedAt === null) return null;

  const terminalAt = run.completed_at
    || run.stopped_at
    || (run.status === "failed" ? run.updated_at : null);
  const endedAt = terminalAt ? parseUtcTimestamp(terminalAt) : now;
  if (endedAt === null || !Number.isFinite(endedAt)) return null;
  return Math.max(0, endedAt - startedAt);
}

function normalizeLimit(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TodayQueueHistoryInputError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

function normalizeProjectId(value) {
  if (value === null || value === undefined || value === "") return null;
  const projectId = Number(value);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new TodayQueueHistoryInputError("project_id must be a positive integer");
  }
  return projectId;
}

function normalizeStatus(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!RUN_STATUSES.includes(value)) {
    throw new TodayQueueHistoryInputError(`status must be one of: ${RUN_STATUSES.join(", ")}`);
  }
  return value;
}

function encodeCursor(row, filters) {
  return Buffer.from(JSON.stringify({
    v: CURSOR_VERSION,
    started_at: row.started_at,
    id: row.id,
    project_id: filters.projectId,
    status: filters.status,
  })).toString("base64url");
}

function decodeCursor(value, filters) {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 2048) {
    throw new TodayQueueHistoryInputError("cursor is invalid or does not match the active filters");
  }
  try {
    const cursor = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (
      cursor?.v !== CURSOR_VERSION
      || typeof cursor.started_at !== "string"
      || parseUtcTimestamp(cursor.started_at) === null
      || typeof cursor.id !== "string"
      || !cursor.id
      || cursor.project_id !== filters.projectId
      || cursor.status !== filters.status
    ) {
      throw new Error("invalid cursor payload");
    }
    return cursor;
  } catch {
    throw new TodayQueueHistoryInputError("cursor is invalid or does not match the active filters");
  }
}

function serializeRun(row, now) {
  return {
    id: row.id,
    project_id: row.project_id,
    project_name: row.project_name,
    project_emoji: row.project_emoji || null,
    status: row.status,
    started_by: row.started_by || null,
    started_at: row.started_at,
    completed_at: row.completed_at || null,
    stopped_at: row.stopped_at || null,
    failure_reason: row.failure_reason || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    task_count: Number(row.task_count || 0),
    attempt_count: Number(row.attempt_count || 0),
    failed_count: Number(row.failed_count || 0),
    duration_ms: durationMs(row, now),
  };
}

function serializeTaskRun(row) {
  return {
    id: row.id,
    run_id: row.run_id,
    project_id: row.project_id,
    item_id: row.item_id,
    category_id: row.category_id ?? null,
    sequence_index: row.sequence_index,
    attempt: row.attempt,
    status: row.status,
    item_title: row.item_title,
    item_content: row.item_content || null,
    category_name: row.category_name || null,
    issue_url: row.issue_url || null,
    bot_key: row.bot_key || null,
    bot_user_id: row.bot_user_id || null,
    dispatch_nonce: row.dispatch_nonce || null,
    dispatch_channel_id: row.dispatch_channel_id || null,
    dispatch_message_id: row.dispatch_message_id || null,
    dispatch_message_url: row.dispatch_message_url || null,
    result_message_id: row.result_message_id || null,
    result_message_url: row.result_message_url || null,
    git_commit: row.git_commit || null,
    queued_at: row.queued_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    stopped_at: row.stopped_at || null,
    error: row.error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createTodayQueueHistoryService({ db, now = () => Date.now() } = {}) {
  if (!db) throw new Error("today queue history service requires db");

  function listRuns(options = {}) {
    const limit = normalizeLimit(options.limit);
    const projectId = normalizeProjectId(options.projectId);
    const status = normalizeStatus(options.status);
    const filters = { projectId, status };
    const cursor = decodeCursor(options.cursor, filters);
    const conditions = [];
    const params = [];

    if (projectId !== null) {
      conditions.push("r.project_id=?");
      params.push(projectId);
    }
    if (status !== null) {
      conditions.push("r.status=?");
      params.push(status);
    }
    if (cursor) {
      conditions.push("(r.started_at < ? OR (r.started_at = ? AND r.id < ?))");
      params.push(cursor.started_at, cursor.started_at, cursor.id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT r.*,
             COUNT(DISTINCT tr.item_id) AS task_count,
             COUNT(tr.id) AS attempt_count,
             COALESCE(SUM(CASE WHEN tr.status='failed' THEN 1 ELSE 0 END), 0) AS failed_count
        FROM today_queue_runs r
        LEFT JOIN today_queue_task_runs tr ON tr.run_id=r.id
        ${where}
       GROUP BY r.id
       ORDER BY r.started_at DESC, r.id DESC
       LIMIT ?
    `).all(...params, limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const currentTime = Number(now());
    return {
      runs: pageRows.map(row => serializeRun(row, currentTime)),
      page: {
        limit,
        has_more: hasMore,
        next_cursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1], filters) : null,
      },
      filters: {
        project_id: projectId,
        status,
      },
    };
  }

  function getRun(runId) {
    if (typeof runId !== "string" || !runId || runId.length > 200) {
      throw new TodayQueueHistoryInputError("run_id is invalid");
    }

    const row = db.prepare(`
      SELECT r.*,
             COUNT(DISTINCT tr.item_id) AS task_count,
             COUNT(tr.id) AS attempt_count,
             COALESCE(SUM(CASE WHEN tr.status='failed' THEN 1 ELSE 0 END), 0) AS failed_count
        FROM today_queue_runs r
        LEFT JOIN today_queue_task_runs tr ON tr.run_id=r.id
       WHERE r.id=?
       GROUP BY r.id
    `).get(runId);
    if (!row) return null;

    const attempts = db.prepare(`
      SELECT *
        FROM today_queue_task_runs
       WHERE run_id=?
       ORDER BY sequence_index ASC, attempt ASC, created_at ASC, id ASC
    `).all(runId);

    return {
      run: serializeRun(row, Number(now())),
      task_runs: attempts.map(serializeTaskRun),
    };
  }

  return {
    listRuns,
    getRun,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  TodayQueueHistoryInputError,
  createTodayQueueHistoryService,
  decodeCursor,
  encodeCursor,
};
