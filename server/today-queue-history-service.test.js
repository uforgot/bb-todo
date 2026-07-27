const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrateTodayQueueHistorySchema } = require("./today-queue-history-schema");
const {
  TodayQueueHistoryInputError,
  createTodayQueueHistoryService,
} = require("./today-queue-history-service");

function createFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT
    );
    CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL
    );
    INSERT INTO projects (id, name, emoji) VALUES
      (1, 'Project A', '🅰️'),
      (2, 'Project B', '🅱️');
    INSERT INTO items (id, project_id) VALUES
      (101, 1),
      (102, 1),
      (201, 2);
  `);
  migrateTodayQueueHistorySchema(db);

  const insertRun = db.prepare(`
    INSERT INTO today_queue_runs (
      id, project_id, project_name, project_emoji, status, started_by,
      started_at, completed_at, stopped_at, failure_reason, created_at, updated_at
    ) VALUES (
      @id, @project_id, @project_name, @project_emoji, @status, @started_by,
      @started_at, @completed_at, @stopped_at, @failure_reason, @created_at, @updated_at
    )
  `);
  const runs = [
    {
      id: "run-c",
      project_id: 1,
      project_name: "Project A",
      project_emoji: "🅰️",
      status: "completed",
      started_by: "api:start",
      started_at: "2026-07-27 10:03:00",
      completed_at: "2026-07-27 10:08:00",
      stopped_at: null,
      failure_reason: null,
      created_at: "2026-07-27 10:03:00",
      updated_at: "2026-07-27 10:08:00",
    },
    {
      id: "run-b",
      project_id: 2,
      project_name: "Project B",
      project_emoji: "🅱️",
      status: "failed",
      started_by: "api:start",
      started_at: "2026-07-27 10:02:00",
      completed_at: null,
      stopped_at: null,
      failure_reason: "worker unavailable",
      created_at: "2026-07-27 10:02:00",
      updated_at: "2026-07-27 10:04:00",
    },
    {
      id: "run-a2",
      project_id: 1,
      project_name: "Project A",
      project_emoji: "🅰️",
      status: "stopped",
      started_by: "api:start",
      started_at: "2026-07-27 10:01:00",
      completed_at: null,
      stopped_at: "2026-07-27 10:02:30",
      failure_reason: null,
      created_at: "2026-07-27 10:01:00",
      updated_at: "2026-07-27 10:02:30",
    },
    {
      id: "run-a1",
      project_id: 1,
      project_name: "Project A",
      project_emoji: "🅰️",
      status: "completed",
      started_by: "api:start",
      started_at: "2026-07-27 10:01:00",
      completed_at: "2026-07-27 10:02:00",
      stopped_at: null,
      failure_reason: null,
      created_at: "2026-07-27 10:01:00",
      updated_at: "2026-07-27 10:02:00",
    },
  ];
  runs.forEach(run => insertRun.run(run));

  const insertTaskRun = db.prepare(`
    INSERT INTO today_queue_task_runs (
      id, run_id, project_id, item_id, sequence_index, attempt, status,
      item_title, item_content, category_name, bot_key, dispatch_nonce,
      dispatch_message_url, result_message_url, git_commit, queued_at,
      started_at, completed_at, error, created_at, updated_at
    ) VALUES (
      @id, @run_id, @project_id, @item_id, @sequence_index, @attempt, @status,
      @item_title, @item_content, @category_name, @bot_key, @dispatch_nonce,
      @dispatch_message_url, @result_message_url, @git_commit, @queued_at,
      @started_at, @completed_at, @error, @created_at, @updated_at
    )
  `);
  const baseTask = {
    project_id: 1,
    category_name: "Queue",
    bot_key: "bbangbbang",
    dispatch_nonce: null,
    dispatch_message_url: null,
    result_message_url: null,
    git_commit: null,
    queued_at: "2026-07-27 10:03:00",
    started_at: null,
    completed_at: null,
    error: null,
    created_at: "2026-07-27 10:03:00",
    updated_at: "2026-07-27 10:03:00",
  };
  [
    {
      ...baseTask,
      id: "task-102-1",
      run_id: "run-c",
      item_id: 102,
      sequence_index: 2,
      attempt: 1,
      status: "pending",
      item_title: "Second task",
      item_content: "second full task content",
    },
    {
      ...baseTask,
      id: "task-101-2",
      run_id: "run-c",
      item_id: 101,
      sequence_index: 1,
      attempt: 2,
      status: "review",
      item_title: "First task",
      item_content: "retry full task content",
      dispatch_nonce: "nonce-2",
      dispatch_message_url: "https://discord.test/dispatch-2",
      result_message_url: "https://discord.test/result-2",
      git_commit: "abcdef1",
      started_at: "2026-07-27 10:05:00",
      completed_at: "2026-07-27 10:08:00",
      created_at: "2026-07-27 10:05:00",
      updated_at: "2026-07-27 10:08:00",
    },
    {
      ...baseTask,
      id: "task-101-1",
      run_id: "run-c",
      item_id: 101,
      sequence_index: 1,
      attempt: 1,
      status: "failed",
      item_title: "First task",
      item_content: "first full task content",
      dispatch_nonce: "nonce-1",
      started_at: "2026-07-27 10:03:00",
      completed_at: "2026-07-27 10:04:00",
      error: "dispatch failed",
      updated_at: "2026-07-27 10:04:00",
    },
    {
      ...baseTask,
      id: "task-b",
      run_id: "run-b",
      project_id: 2,
      item_id: 201,
      sequence_index: 1,
      attempt: 1,
      status: "failed",
      item_title: "Project B task",
      item_content: "B full task content",
      error: "worker unavailable",
      started_at: "2026-07-27 10:02:00",
      completed_at: "2026-07-27 10:04:00",
      created_at: "2026-07-27 10:02:00",
      updated_at: "2026-07-27 10:04:00",
    },
  ].forEach(taskRun => insertTaskRun.run(taskRun));

  return {
    db,
    service: createTodayQueueHistoryService({
      db,
      now: () => Date.parse("2026-07-27T10:10:00Z"),
    }),
  };
}

test("paginates runs with a stable timestamp and id cursor", () => {
  const fixture = createFixture();
  const first = fixture.service.listRuns({ limit: 2 });
  assert.deepEqual(first.runs.map(run => run.id), ["run-c", "run-b"]);
  assert.equal(first.page.has_more, true);
  assert.ok(first.page.next_cursor);

  const second = fixture.service.listRuns({
    limit: 2,
    cursor: first.page.next_cursor,
  });
  assert.deepEqual(second.runs.map(run => run.id), ["run-a2", "run-a1"]);
  assert.equal(second.page.has_more, false);
  assert.equal(second.page.next_cursor, null);
  assert.equal(new Set([...first.runs, ...second.runs].map(run => run.id)).size, 4);
  fixture.db.close();
});

test("filters by project and status and binds the cursor to those filters", () => {
  const fixture = createFixture();
  const completed = fixture.service.listRuns({
    projectId: 1,
    status: "completed",
    limit: 1,
  });
  assert.deepEqual(completed.runs.map(run => run.id), ["run-c"]);
  assert.deepEqual(completed.filters, { project_id: 1, status: "completed" });

  const next = fixture.service.listRuns({
    projectId: 1,
    status: "completed",
    limit: 1,
    cursor: completed.page.next_cursor,
  });
  assert.deepEqual(next.runs.map(run => run.id), ["run-a1"]);
  assert.throws(
    () => fixture.service.listRuns({ projectId: 2, cursor: completed.page.next_cursor }),
    error => error instanceof TodayQueueHistoryInputError && /active filters/.test(error.message),
  );
  fixture.db.close();
});

test("returns aggregate counts and duration without task content in the list", () => {
  const fixture = createFixture();
  const response = fixture.service.listRuns({ projectId: 1, status: "completed" });
  const run = response.runs.find(entry => entry.id === "run-c");
  assert.deepEqual(
    {
      task_count: run.task_count,
      attempt_count: run.attempt_count,
      failed_count: run.failed_count,
      duration_ms: run.duration_ms,
    },
    {
      task_count: 2,
      attempt_count: 3,
      failed_count: 1,
      duration_ms: 300_000,
    },
  );
  assert.equal("task_runs" in run, false);
  assert.doesNotMatch(JSON.stringify(response), /full task content/);
  fixture.db.close();
});

test("returns ordered task attempts and full snapshots only in run detail", () => {
  const fixture = createFixture();
  const detail = fixture.service.getRun("run-c");
  assert.equal(detail.run.duration_ms, 300_000);
  assert.deepEqual(
    detail.task_runs.map(attempt => [attempt.item_id, attempt.attempt, attempt.status]),
    [
      [101, 1, "failed"],
      [101, 2, "review"],
      [102, 1, "pending"],
    ],
  );
  assert.equal(detail.task_runs[0].item_content, "first full task content");
  assert.equal(detail.task_runs[1].git_commit, "abcdef1");
  assert.equal(detail.task_runs[1].result_message_url, "https://discord.test/result-2");
  assert.equal(fixture.service.getRun("missing-run"), null);
  fixture.db.close();
});

test("rejects invalid pagination and filter inputs", () => {
  const fixture = createFixture();
  const invalidCalls = [
    () => fixture.service.listRuns({ limit: 0 }),
    () => fixture.service.listRuns({ limit: 101 }),
    () => fixture.service.listRuns({ projectId: -1 }),
    () => fixture.service.listRuns({ status: "review" }),
    () => fixture.service.listRuns({ cursor: "not-a-cursor" }),
    () => fixture.service.getRun(""),
  ];
  invalidCalls.forEach(call => assert.throws(call, TodayQueueHistoryInputError));
  fixture.db.close();
});
