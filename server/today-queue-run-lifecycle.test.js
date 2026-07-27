const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrateTodayQueueHistorySchema } = require("./today-queue-history-schema");
const { createTodayQueueRunLifecycle } = require("./today-queue-run-lifecycle");
const { createTodayQueueService } = require("./today-queue-service");
const { createTodayQueueResultHandler } = require("./today-queue-result-handler");
const { validateGitCommitDeclaration } = require("./today-queue-policy");

function marker(itemId, nonce, gitCommit = "abc1234") {
  const raw = [
    "DUDU_RESULT_V1",
    "run_id: today-queue",
    `item_id: ${itemId}`,
    `nonce: ${nonce}`,
    "status: ready_for_review",
    `git_commit: ${gitCommit}`,
    "evidence: verified",
  ].join("\n");
  return {
    run_id: "today-queue",
    item_id: itemId,
    nonce,
    status: "ready_for_review",
    evidence: "verified",
    raw,
  };
}

function createFixture({ failOnce = [], singleItemProject = false } = {}) {
  const db = new Database(":memory:");
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
      updated_at TEXT DEFAULT (datetime('now')),
      is_today INTEGER DEFAULT 0,
      today_queue_order INTEGER,
      owner TEXT,
      review_count INTEGER DEFAULT 0,
      review_emoji TEXT,
      dispatch_nonce TEXT,
      dispatch_message_id TEXT,
      dispatch_channel_id TEXT,
      dispatch_message_url TEXT,
      dispatch_target_bot_key TEXT,
      dispatch_target_bot_user_id TEXT,
      dispatch_started_at TEXT,
      dispatch_attempt_count INTEGER DEFAULT 0,
      dispatch_last_error TEXT
    );
    INSERT INTO projects (
      id, name, emoji, sort_order, discord_channel_id, default_ai_bot_key
    ) VALUES
      (1, 'Project A', '🅰️', 1, 'channel-a', 'bbangbbang'),
      (2, 'Project B', '🅱️', 2, 'channel-b', 'pangpang');
    INSERT INTO items (
      id, project_id, status, title, content, sort_order, is_today,
      today_queue_order, owner
    ) VALUES
      (101, 1, 'todo', 'A first', 'A first content', 1, 1, 1, 'AI'),
      (102, 1, 'todo', 'A second', 'A second content', 2, 1, 2, 'AI'),
      (201, 2, 'todo', 'B first', 'B first content', 1, 1, 1, 'AI'),
      (202, 2, 'todo', 'B second', 'B second content', 2, 1, 2, 'AI');
  `);
  if (singleItemProject) {
    db.prepare("UPDATE items SET status='review' WHERE id IN (102, 202)").run();
  }
  migrateTodayQueueHistorySchema(db);

  const counters = { run: 0, task: 0, nonce: 0, message: 0 };
  const createId = type => `${type}-${++counters[type]}`;
  const failures = new Map(failOnce.map(itemId => [itemId, 1]));
  const dispatches = [];
  const events = [];
  const lifecycle = createTodayQueueRunLifecycle({ db, createId });

  const makeService = () => createTodayQueueService({
    db,
    serializeTodoItem: item => ({
      id: item.id,
      title: item.title,
      content: item.content,
      status: item.status,
      owner: item.owner,
      is_today: Boolean(item.is_today),
      dispatch_nonce: item.dispatch_nonce || null,
      dispatch_message_id: item.dispatch_message_id || null,
      dispatch_channel_id: item.dispatch_channel_id || null,
      dispatch_message_url: item.dispatch_message_url || null,
      dispatch_target_bot_key: item.dispatch_target_bot_key || null,
      dispatch_target_bot_user_id: item.dispatch_target_bot_user_id || null,
      dispatch_started_at: item.dispatch_started_at || null,
      dispatch_attempt_count: item.dispatch_attempt_count || 0,
      dispatch_last_error: item.dispatch_last_error || null,
    }),
    normalizeBotKey: key => key,
    defaultBotKey: "bbangbbang",
    createDispatchNonce: () => `nonce-${++counters.nonce}`,
    runLifecycle: lifecycle,
    dispatchItem: async (item, options) => {
      const persistedAttempt = db.prepare(
        "SELECT run_id, item_id, status, dispatch_nonce FROM today_queue_task_runs WHERE id=?",
      ).get(options.taskRunId);
      assert.deepEqual(persistedAttempt, {
        run_id: options.runId,
        item_id: item.id,
        status: "active",
        dispatch_nonce: options.nonce,
      });
      if ((failures.get(item.id) || 0) > 0) {
        failures.set(item.id, failures.get(item.id) - 1);
        throw new Error(`dispatch failed for ${item.id}`);
      }
      const messageId = `message-${++counters.message}`;
      const channelId = item.discord_thread_id || item.discord_channel_id;
      const dispatch = {
        item_id: item.id,
        channel_id: channelId,
        message_id: messageId,
        message_url: `https://discord.test/${channelId}/${messageId}`,
        nonce: options.nonce,
        target_bot: options.botKey,
        target_bot_user_id: options.botKey === "pangpang" ? "bot-b" : "bot-a",
      };
      dispatches.push({ itemId: item.id, runId: options.runId, taskRunId: options.taskRunId, ...dispatch });
      return dispatch;
    },
    recordFailure: (itemId, error) => db.prepare(
      "UPDATE items SET dispatch_last_error=? WHERE id=?",
    ).run(String(error?.message || error), itemId),
  });

  const makeHandler = service => createTodayQueueResultHandler({
    getItemById: itemId => service.getItemById(itemId),
    validateGitCommitDeclaration,
    acceptResult: ({ item, marker: resultMarker, msg, gitCommit }) => lifecycle.acceptResult({
      itemId: item.id,
      nonce: resultMarker.nonce,
      resultMessageId: msg.id,
      resultMessageUrl: msg.url,
      gitCommit,
    }),
    dispatchNext: (projectId, options = {}) => service.dispatchNext({
      projectId,
      startedBy: options.startedBy,
      expectedRunId: options.runId,
    }),
    broadcast: (event, payload) => events.push({ event, payload }),
  });

  const message = projectId => ({
    id: `result-${projectId}-${counters.message}`,
    url: `https://discord.test/channel-${projectId === 1 ? "a" : "b"}/result-${projectId}-${counters.message}`,
    channelId: `channel-${projectId === 1 ? "a" : "b"}`,
    author: {
      id: projectId === 1 ? "bot-a" : "bot-b",
      bot: true,
    },
  });

  const service = makeService();
  service.initializeOrder();
  return {
    db,
    lifecycle,
    service,
    makeService,
    makeHandler,
    handler: makeHandler(service),
    message,
    dispatches,
    events,
  };
}

function currentRunId(db, projectId) {
  return db.prepare("SELECT current_run_id FROM projects WHERE id=?").get(projectId).current_run_id;
}

function run(db, runId) {
  return db.prepare("SELECT * FROM today_queue_runs WHERE id=?").get(runId);
}

function taskRuns(db, runId, itemId = null) {
  const where = itemId === null ? "run_id=?" : "run_id=? AND item_id=?";
  const params = itemId === null ? [runId] : [runId, itemId];
  return db.prepare(`
    SELECT * FROM today_queue_task_runs
     WHERE ${where}
     ORDER BY sequence_index, attempt
  `).all(...params);
}

test("keeps concurrent project run identities and dispatch metadata isolated", async () => {
  const fixture = createFixture();
  const [a, b] = await Promise.all([
    fixture.service.dispatchNext({ projectId: 1, startedBy: "api:start" }),
    fixture.service.dispatchNext({ projectId: 2, startedBy: "api:start" }),
  ]);

  assert.equal(a.started, true);
  assert.equal(b.started, true);
  assert.notEqual(a.run_id, b.run_id);
  assert.equal(currentRunId(fixture.db, 1), a.run_id);
  assert.equal(currentRunId(fixture.db, 2), b.run_id);
  assert.deepEqual(fixture.dispatches.map(entry => [entry.itemId, entry.runId]), [
    [101, a.run_id],
    [201, b.run_id],
  ]);
  assert.deepEqual(taskRuns(fixture.db, a.run_id).map(row => [row.item_id, row.status]), [
    [101, "active"],
    [102, "pending"],
  ]);
  assert.deepEqual(taskRuns(fixture.db, b.run_id).map(row => [row.item_id, row.status]), [
    [201, "active"],
    [202, "pending"],
  ]);
  assert.match(taskRuns(fixture.db, a.run_id, 101)[0].dispatch_message_url, /channel-a/);
  assert.match(taskRuns(fixture.db, b.run_id, 201)[0].dispatch_message_url, /channel-b/);
  fixture.db.close();
});

test("persists an accepted result and advances only the same run", async () => {
  const fixture = createFixture();
  const a = await fixture.service.dispatchNext({ projectId: 1 });
  const b = await fixture.service.dispatchNext({ projectId: 2 });
  const accepted = await fixture.handler(
    fixture.message(1),
    marker(101, a.dispatch.nonce, "abcdef1"),
  );

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.run_id, a.run_id);
  assert.equal(accepted.next.run_id, a.run_id);
  assert.equal(accepted.next.item.id, 102);
  assert.equal(fixture.service.buildProjectStatus(2).active[0].id, 201);
  assert.equal(currentRunId(fixture.db, 2), b.run_id);

  const first = taskRuns(fixture.db, a.run_id, 101)[0];
  const second = taskRuns(fixture.db, a.run_id, 102)[0];
  assert.equal(first.status, "review");
  assert.equal(first.git_commit, "abcdef1");
  assert.match(first.result_message_url, /result-1/);
  assert.equal(second.status, "active");
  assert.equal(taskRuns(fixture.db, b.run_id, 201)[0].status, "active");
  fixture.db.close();
});

test("does not mutate history for stale or duplicate result markers", async () => {
  const fixture = createFixture();
  const started = await fixture.service.dispatchNext({ projectId: 1 });
  const before = taskRuns(fixture.db, started.run_id, 101)[0];

  const stale = await fixture.handler(fixture.message(1), marker(101, "wrong-nonce"));
  assert.equal(stale.reason, "nonce_mismatch");
  assert.deepEqual(taskRuns(fixture.db, started.run_id, 101)[0], before);

  const validMarker = marker(101, started.dispatch.nonce);
  assert.equal((await fixture.handler(fixture.message(1), validMarker)).accepted, true);
  const afterAccepted = taskRuns(fixture.db, started.run_id, 101)[0];
  const dispatchCount = fixture.dispatches.length;
  const duplicate = await fixture.handler(fixture.message(1), validMarker);
  assert.equal(duplicate.reason, "item_not_in_progress");
  assert.deepEqual(taskRuns(fixture.db, started.run_id, 101)[0], afterAccepted);
  assert.equal(fixture.dispatches.length, dispatchCount);
  fixture.db.close();
});

test("appends a retry attempt while preserving the failed attempt", async () => {
  const fixture = createFixture({ failOnce: [101] });
  const failed = await fixture.service.dispatchNext({ projectId: 1 });
  assert.equal(failed.reason, "dispatch_failed");
  assert.equal(taskRuns(fixture.db, failed.run_id, 101)[0].status, "failed");
  assert.match(taskRuns(fixture.db, failed.run_id, 101)[0].error, /dispatch failed for 101/);

  const retried = await fixture.service.dispatchNext({ projectId: 1 });
  assert.equal(retried.started, true);
  assert.equal(retried.run_id, failed.run_id);
  assert.equal(retried.attempt, 2);
  assert.deepEqual(taskRuns(fixture.db, failed.run_id, 101).map(row => [row.attempt, row.status]), [
    [1, "failed"],
    [2, "active"],
  ]);
  assert.match(taskRuns(fixture.db, failed.run_id, 101)[0].error, /dispatch failed for 101/);
  fixture.db.close();
});

test("stops only the selected project run", async () => {
  const fixture = createFixture();
  const a = await fixture.service.dispatchNext({ projectId: 1 });
  const b = await fixture.service.dispatchNext({ projectId: 2 });

  const stopped = fixture.service.stop({ projectId: 1 });
  assert.equal(stopped.stopped, 1);
  assert.equal(run(fixture.db, a.run_id).status, "stopped");
  assert.equal(taskRuns(fixture.db, a.run_id, 101)[0].status, "stopped");
  assert.equal(currentRunId(fixture.db, 1), null);
  assert.equal(fixture.db.prepare("SELECT status FROM items WHERE id=101").get().status, "todo");

  assert.equal(run(fixture.db, b.run_id).status, "running");
  assert.equal(taskRuns(fixture.db, b.run_id, 201)[0].status, "active");
  assert.equal(currentRunId(fixture.db, 2), b.run_id);
  assert.equal(fixture.db.prepare("SELECT status FROM items WHERE id=201").get().status, "in_progress");
  fixture.db.close();
});

test("rejects continuation when the expected run is no longer current", async () => {
  const fixture = createFixture();
  const started = await fixture.service.dispatchNext({ projectId: 1 });
  fixture.service.stop({ projectId: 1 });
  const dispatchCount = fixture.dispatches.length;

  const staleContinuation = await fixture.service.dispatchNext({
    projectId: 1,
    expectedRunId: started.run_id,
    startedBy: "result-marker",
  });
  assert.equal(staleContinuation.reason, "run_mismatch");
  assert.equal(staleContinuation.expected_run_id, started.run_id);
  assert.equal(staleContinuation.current_run_id, null);
  assert.equal(fixture.dispatches.length, dispatchCount);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) count FROM today_queue_runs").get().count, 1);
  fixture.db.close();
});

test("reuses the persisted run identity after service restart", async () => {
  const fixture = createFixture();
  const started = await fixture.service.dispatchNext({ projectId: 1 });
  const restartedService = fixture.makeService();
  restartedService.initializeOrder();

  const duplicateStart = await restartedService.dispatchNext({ projectId: 1 });
  assert.equal(duplicateStart.reason, "already_running");
  assert.equal(currentRunId(fixture.db, 1), started.run_id);

  const restartedHandler = fixture.makeHandler(restartedService);
  const accepted = await restartedHandler(
    fixture.message(1),
    marker(101, started.dispatch.nonce),
  );
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.run_id, started.run_id);
  assert.equal(accepted.next.run_id, started.run_id);
  assert.equal(accepted.next.item.id, 102);
  fixture.db.close();
});

test("marks the run completed when the accepted result exhausts todo items", async () => {
  const fixture = createFixture({ singleItemProject: true });
  const started = await fixture.service.dispatchNext({ projectId: 1 });
  const accepted = await fixture.handler(
    fixture.message(1),
    marker(101, started.dispatch.nonce),
  );

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.next.reason, "empty");
  assert.equal(accepted.next.completed_run_id, started.run_id);
  assert.equal(run(fixture.db, started.run_id).status, "completed");
  assert.equal(taskRuns(fixture.db, started.run_id, 101)[0].status, "review");
  assert.equal(currentRunId(fixture.db, 1), null);
  assert.equal(fixture.db.prepare("SELECT current_task_run_id FROM items WHERE id=101").get().current_task_run_id, null);
  fixture.db.close();
});
