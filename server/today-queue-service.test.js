/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { createTodayQueueService, normalizeProjectId } = require("./today-queue-service");

function createFixture({ waitForDispatch = false } = {}) {
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
      is_today INTEGER DEFAULT 0,
      owner TEXT,
      dispatch_nonce TEXT,
      dispatch_started_at TEXT,
      dispatch_last_error TEXT
    );
  `);

  const insertProject = db.prepare(`
    INSERT INTO projects (id, name, emoji, sort_order, discord_channel_id, default_ai_bot_key)
    VALUES (?, ?, ?, ?, ?, 'bbangbbang')
  `);
  insertProject.run(1, "A", "🅰️", 1, "channel-a");
  insertProject.run(2, "B", "🅱️", 2, "channel-b");
  insertProject.run(3, "Empty", "0️⃣", 3, "channel-empty");
  insertProject.run(4, "Missing target", "⚠️", 4, null);
  insertProject.run(5, "Failure", "💥", 5, "channel-fail");

  db.prepare("INSERT INTO categories (id, project_id, name, sort_order) VALUES (11, 1, 'Later', 1)").run();
  const insertItem = db.prepare(`
    INSERT INTO items (id, project_id, category_id, status, title, sort_order, is_today, owner)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertItem.run(101, 1, null, "todo", "A root", 1, 1, "AI");
  insertItem.run(102, 1, 11, "todo", "A category", 1, 1, "AI");
  insertItem.run(103, 1, null, "review", "A review", 2, 1, "AI");
  insertItem.run(104, 1, null, "todo", "A human", 3, 1, null);
  insertItem.run(201, 2, null, "todo", "B first", 1, 1, "AI");
  insertItem.run(202, 2, null, "todo", "B second", 2, 1, "AI");
  insertItem.run(401, 4, null, "todo", "No Discord", 1, 1, "AI");
  insertItem.run(501, 5, null, "todo", "Discord failure", 1, 1, "AI");

  let releaseDispatch;
  const dispatchGate = waitForDispatch
    ? new Promise(resolve => { releaseDispatch = resolve; })
    : Promise.resolve();
  const dispatched = [];
  const makeService = () => createTodayQueueService({
    db,
    serializeTodoItem: item => ({ id: item.id, title: item.title, status: item.status }),
    normalizeBotKey: key => key,
    defaultBotKey: "bbangbbang",
    dispatchItem: async (item) => {
      dispatched.push(item.id);
      await dispatchGate;
      if (item.project_id === 5) throw new Error("Discord unavailable");
      db.prepare("UPDATE items SET status='in_progress', dispatch_nonce=? WHERE id=?")
        .run(`nonce-${item.id}`, item.id);
      return { item_id: item.id };
    },
    recordFailure: (itemId, error) => {
      db.prepare("UPDATE items SET dispatch_last_error=? WHERE id=?")
        .run(String(error?.message || error), itemId);
    },
  });
  const service = makeService();

  return { db, service, makeService, dispatched, releaseDispatch };
}

test("normalizes optional positive project ids", () => {
  assert.equal(normalizeProjectId(undefined), null);
  assert.equal(normalizeProjectId("7"), 7);
  assert.equal(normalizeProjectId(0), undefined);
  assert.equal(normalizeProjectId("nope"), undefined);
});

test("builds isolated project status and preserves project item order", () => {
  const { db, service } = createFixture();
  const status = service.buildStatus({ projectId: 1 });

  assert.deepEqual(status.projects.map(project => project.project_id), [1]);
  assert.deepEqual(status.projects[0].items.map(item => item.id), [101, 103, 102]);
  assert.equal(status.projects[0].next.id, 101);
  assert.deepEqual(status.projects[0].counts, { todo: 2, in_progress: 0, review: 1, total: 3 });
  assert.equal(status.items.some(item => item.project_id === 2), false);
  assert.equal(service.buildStatus({ projectId: 3 }).projects[0].counts.total, 0);
  db.close();
});

test("runs projects in parallel while keeping one active item per project", async () => {
  const { db, service, dispatched } = createFixture();
  const [a, b] = await Promise.all([
    service.dispatchNext({ projectId: 1 }),
    service.dispatchNext({ projectId: 2 }),
  ]);

  assert.equal(a.started, true);
  assert.equal(b.started, true);
  assert.deepEqual(dispatched, [101, 201]);
  assert.equal(service.buildProjectStatus(1).active[0].id, 101);
  assert.equal(service.buildProjectStatus(2).active[0].id, 201);

  const sameProject = await service.dispatchNext({ projectId: 1 });
  assert.equal(sameProject.reason, "already_running");
  assert.deepEqual(dispatched, [101, 201]);
  db.close();
});

test("serializes overlapping starts for the same project", async () => {
  const { db, service, dispatched, releaseDispatch } = createFixture({ waitForDispatch: true });
  const first = service.dispatchNext({ projectId: 1 });
  await new Promise(resolve => setImmediate(resolve));
  const duplicate = await service.dispatchNext({ projectId: 1 });

  assert.equal(duplicate.reason, "action_in_progress");
  assert.deepEqual(dispatched, [101]);
  releaseDispatch();
  assert.equal((await first).started, true);
  db.close();
});

test("recovers persisted active state after service restart", async () => {
  const { db, service, makeService, dispatched } = createFixture();
  await service.dispatchNext({ projectId: 1 });

  const restartedService = makeService();
  assert.equal((await restartedService.dispatchNext({ projectId: 1 })).reason, "already_running");
  assert.equal((await restartedService.dispatchNext({ projectId: 2 })).started, true);
  assert.deepEqual(dispatched, [101, 201]);
  db.close();
});

test("stops only the selected project", async () => {
  const { db, service } = createFixture();
  await service.dispatchNext({ projectId: 1 });
  await service.dispatchNext({ projectId: 2 });

  const stopped = service.stop({ projectId: 1 });
  assert.equal(stopped.stopped, 1);
  assert.equal(stopped.status.running, false);
  assert.equal(service.buildProjectStatus(2).running, true);
  assert.equal(db.prepare("SELECT status FROM items WHERE id=101").get().status, "todo");
  assert.equal(db.prepare("SELECT status FROM items WHERE id=201").get().status, "in_progress");
  db.close();
});

test("keeps the first item pending on empty, missing target, and dispatch failure", async () => {
  const { db, service, dispatched } = createFixture();

  assert.equal((await service.dispatchNext({ projectId: 3 })).reason, "empty");
  assert.equal((await service.dispatchNext({ projectId: 4 })).reason, "missing_discord_target");
  assert.equal((await service.dispatchNext({ projectId: 5 })).reason, "dispatch_failed");
  assert.equal(db.prepare("SELECT status FROM items WHERE id=401").get().status, "todo");
  assert.equal(db.prepare("SELECT status FROM items WHERE id=501").get().status, "todo");
  assert.match(db.prepare("SELECT dispatch_last_error FROM items WHERE id=401").get().dispatch_last_error, /no Discord/);
  assert.match(db.prepare("SELECT dispatch_last_error FROM items WHERE id=501").get().dispatch_last_error, /unavailable/);
  assert.deepEqual(dispatched, [501]);
  db.close();
});
