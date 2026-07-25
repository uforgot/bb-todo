/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTodayQueueResultHandler } = require("./today-queue-result-handler");
const { validateGitCommitDeclaration } = require("./today-queue-policy");

function createMarker(itemId, nonce) {
  const raw = [
    "DUDU_RESULT_V1",
    "run_id: today-queue",
    `item_id: ${itemId}`,
    `nonce: ${nonce}`,
    "status: ready_for_review",
    "git_commit: abc1234",
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

function createFixture() {
  const items = new Map([
    [101, {
      id: 101,
      project_id: 1,
      status: "in_progress",
      owner: "AI",
      is_today: 1,
      dispatch_nonce: "nonce-a",
      dispatch_message_id: "prompt-a",
      dispatch_channel_id: "channel-a",
      dispatch_target_bot_user_id: "bot-a",
    }],
    [201, {
      id: 201,
      project_id: 2,
      status: "in_progress",
      owner: "AI",
      is_today: 1,
      dispatch_nonce: "nonce-b",
      dispatch_message_id: "prompt-b",
      dispatch_channel_id: "channel-b",
      dispatch_target_bot_user_id: "bot-b",
    }],
  ]);
  const nextCalls = [];
  const events = [];

  const handler = createTodayQueueResultHandler({
    getItemById: itemId => items.get(itemId) || null,
    validateGitCommitDeclaration,
    markItemReview: (itemId, nonce) => {
      const item = items.get(itemId);
      if (!item || item.status !== "in_progress" || item.dispatch_nonce !== nonce) return { changes: 0 };
      item.status = "review";
      return { changes: 1 };
    },
    dispatchNext: async projectId => {
      nextCalls.push(projectId);
      return { started: true, reason: "dispatched", dispatch: { item_id: projectId === 1 ? 102 : 202 } };
    },
    broadcast: (event, payload) => events.push({ event, payload }),
  });

  const message = (projectId, overrides = {}) => ({
    id: `result-${projectId}`,
    channelId: `channel-${projectId === 1 ? "a" : "b"}`,
    author: {
      id: `bot-${projectId === 1 ? "a" : "b"}`,
      bot: true,
    },
    ...overrides,
  });

  return { items, handler, message, nextCalls, events };
}

test("continues each accepted result inside its own project", async () => {
  const { handler, message, nextCalls, events } = createFixture();
  const [a, b] = await Promise.all([
    handler(message(1), createMarker(101, "nonce-a")),
    handler(message(2), createMarker(201, "nonce-b")),
  ]);

  assert.equal(a.accepted, true);
  assert.equal(a.project_id, 1);
  assert.equal(b.accepted, true);
  assert.equal(b.project_id, 2);
  assert.deepEqual(nextCalls.sort(), [1, 2]);
  assert.deepEqual(
    events.filter(entry => entry.payload.action === "next-after-result").map(entry => entry.payload.projectId).sort(),
    [1, 2],
  );
  assert.deepEqual(
    events.filter(entry => entry.payload.action === "next-after-result").map(entry => entry.payload.itemId).sort(),
    [102, 202],
  );
});

test("rejects duplicate, wrong nonce, author, and channel without continuing", async () => {
  const cases = [
    {
      name: "nonce_mismatch",
      marker: createMarker(101, "wrong"),
      message: fixture => fixture.message(1),
    },
    {
      name: "author_mismatch",
      marker: createMarker(101, "nonce-a"),
      message: fixture => fixture.message(1, { author: { id: "other-bot", bot: true } }),
    },
    {
      name: "channel_mismatch",
      marker: createMarker(101, "nonce-a"),
      message: fixture => fixture.message(1, { channelId: "other-channel" }),
    },
  ];

  for (const testCase of cases) {
    const fixture = createFixture();
    const result = await fixture.handler(testCase.message(fixture), testCase.marker);
    assert.equal(result.reason, testCase.name);
    assert.deepEqual(fixture.nextCalls, []);
  }

  const fixture = createFixture();
  const marker = createMarker(101, "nonce-a");
  assert.equal((await fixture.handler(fixture.message(1), marker)).accepted, true);
  assert.equal((await fixture.handler(fixture.message(1), marker)).reason, "item_not_in_progress");
  assert.deepEqual(fixture.nextCalls, [1]);
});
