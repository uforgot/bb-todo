/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events } = require("discord.js");
const { attach, isCompleteResultMarker, parseDuduResultMarker } = require("./today-queue-bridge");

const marker = [
  "DUDU_RESULT_V1",
  "run_id: today-queue",
  "item_id: 1043",
  "nonce: 8e9a4d1ad7a55e7d5bd23685",
  "status: ready_for_review",
  "git_commit: abc1234",
].join("\n");

function flushEvents() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("parseDuduResultMarker parses a complete result block", () => {
  assert.deepEqual(
    parseDuduResultMarker(marker),
    {
      run_id: "today-queue",
      item_id: 1043,
      nonce: "8e9a4d1ad7a55e7d5bd23685",
      status: "ready_for_review",
      evidence: "",
      raw: marker,
    },
  );
});

test("accepts an indented YAML result block", () => {
  const parsed = parseDuduResultMarker([
    "DUDU_RESULT_V1:",
    "  run_id: today-queue",
    "  item_id: 1043",
    "  nonce: 8e9a4d1ad7a55e7d5bd23685",
    "  status: ready_for_review",
    "  git_commit: abc1234",
  ].join("\n"));

  assert.equal(isCompleteResultMarker(parsed), true);
});

test("attach recovers a missed result marker for an active item", async () => {
  const client = new EventEmitter();
  const accepted = [];
  const bridge = attach(client, {
    onResult: async (msg, parsed) => {
      accepted.push({ id: msg.id, marker: parsed });
      return { accepted: true };
    },
    getActiveItems: async () => [{ id: 1043, dispatch_channel_id: "channel-1" }],
    fetchMessages: async (channelId) => [{
      id: "100",
      channelId,
      content: marker,
      author: { id: "bot-1", bot: true, tag: "worker#0001" },
    }],
    recoveryIntervalMs: 0,
    logger: { log() {}, error() {} },
  });

  await bridge.recoverActiveResults();

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, "100");
  assert.equal(accepted[0].marker.item_id, 1043);
});

test("attach paginates recovery back to the active dispatch message", async () => {
  const client = new EventEmitter();
  const accepted = [];
  const fetchOptions = [];
  client.channels = {
    fetch: async () => ({
      messages: {
        fetch: async (options) => {
          fetchOptions.push(options);
          if (!options.before) {
            return new Map(Array.from({ length: 100 }, (_, index) => {
              const id = String(200 + index);
              return [id, {
                id,
                channelId: "channel-1",
                content: "progress",
                author: { id: "bot-1", bot: true },
              }];
            }));
          }
          return new Map([["150", {
            id: "150",
            channelId: "channel-1",
            content: marker,
            author: { id: "bot-1", bot: true, tag: "worker#0001" },
          }]]);
        },
      },
    }),
  };

  const bridge = attach(client, {
    onResult: async (msg, parsed) => {
      accepted.push({ id: msg.id, marker: parsed });
      return { accepted: true };
    },
    getActiveItems: async () => [{
      id: 1043,
      dispatch_channel_id: "channel-1",
      dispatch_message_id: "100",
    }],
    recoveryIntervalMs: 0,
    logger: { log() {}, error() {} },
  });

  await bridge.recoverActiveResults();

  assert.equal(fetchOptions.length, 2);
  assert.equal(fetchOptions[1].before, "200");
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, "150");
});

test("attach handles a marker added by Discord message streaming edit", async () => {
  const client = new EventEmitter();
  const accepted = [];
  attach(client, {
    onResult: async (msg, parsed) => {
      accepted.push({ id: msg.id, marker: parsed });
      return { accepted: true };
    },
    logger: { log() {}, error() {} },
  });

  const original = {
    id: "message-1",
    content: "1043 작업 끝냈어.",
    author: { id: "bot-1", bot: true, tag: "worker#0001" },
  };
  client.emit(Events.MessageCreate, original);
  await flushEvents();
  assert.equal(accepted.length, 0);

  const updated = { ...original, content: `1043 작업 끝냈어.\n\n${marker}` };
  client.emit(Events.MessageUpdate, original, updated);
  await flushEvents();

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, "message-1");
  assert.equal(accepted[0].marker.item_id, 1043);
});

test("attach joins a result marker split after item_id across consecutive bot messages", async () => {
  const client = new EventEmitter();
  const accepted = [];
  attach(client, {
    onResult: async (msg, parsed) => {
      accepted.push({ id: msg.id, marker: parsed });
      return { accepted: true };
    },
    logger: { log() {}, error() {} },
  });

  const shared = {
    channelId: "channel-1",
    author: { id: "bot-1", bot: true, tag: "worker#0001" },
  };
  client.emit(Events.MessageCreate, {
    ...shared,
    id: "message-1",
    content: [
      "작업 결과",
      "DUDU_RESULT_V1",
      "run_id: today-queue",
      "item_id: 1043",
    ].join("\n"),
  });
  await flushEvents();
  assert.equal(accepted.length, 0);

  client.emit(Events.MessageCreate, {
    ...shared,
    id: "message-2",
    content: [
      "nonce: 8e9a4d1ad7a55e7d5bd23685",
      "status: ready_for_review",
      "git_commit: abc1234",
      "evidence: verified",
    ].join("\n"),
  });
  await flushEvents();

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, "message-2");
  assert.equal(accepted[0].marker.item_id, 1043);
  assert.equal(accepted[0].marker.nonce, "8e9a4d1ad7a55e7d5bd23685");
  assert.equal(accepted[0].marker.status, "ready_for_review");
  assert.equal(accepted[0].marker.evidence, "verified");
});

test("attach waits for fragments split after item_id, nonce, or status", async () => {
  const lines = [
    "DUDU_RESULT_V1",
    "run_id: today-queue",
    "item_id: 1043",
    "nonce: 8e9a4d1ad7a55e7d5bd23685",
    "status: ready_for_review",
    "git_commit: abc1234",
    "evidence: verified",
  ];

  for (const splitAfter of [2, 3, 4]) {
    const client = new EventEmitter();
    const accepted = [];
    attach(client, {
      onResult: async (_msg, parsed) => {
        accepted.push(parsed);
        return { accepted: true };
      },
      logger: { log() {}, error() {} },
    });
    const shared = {
      channelId: `channel-${splitAfter}`,
      author: { id: "bot-1", bot: true, tag: "worker#0001" },
    };

    client.emit(Events.MessageCreate, {
      ...shared,
      id: `first-${splitAfter}`,
      content: lines.slice(0, splitAfter + 1).join("\n"),
    });
    await flushEvents();
    assert.equal(accepted.length, 0, `split after ${lines[splitAfter]} must wait`);

    client.emit(Events.MessageCreate, {
      ...shared,
      id: `second-${splitAfter}`,
      content: lines.slice(splitAfter + 1).join("\n"),
    });
    await flushEvents();
    assert.equal(accepted.length, 1, `split after ${lines[splitAfter]} must complete`);
    assert.equal(accepted[0].item_id, 1043);
  }
});

test("attach updates a streamed continuation fragment instead of duplicating it", async () => {
  const client = new EventEmitter();
  const accepted = [];
  attach(client, {
    onResult: async (_msg, parsed) => {
      accepted.push(parsed);
      return { accepted: true };
    },
    logger: { log() {}, error() {} },
  });

  const shared = {
    channelId: "channel-1",
    author: { id: "bot-1", bot: true, tag: "worker#0001" },
  };
  const first = {
    ...shared,
    id: "message-1",
    content: "DUDU_RESULT_V1\nrun_id: today-queue\nitem_id: 1043",
  };
  const continuation = {
    ...shared,
    id: "message-2",
    content: "nonce: 8e9a4d1ad7a55e7d5bd23685",
  };
  client.emit(Events.MessageCreate, first);
  client.emit(Events.MessageCreate, continuation);
  await flushEvents();
  assert.equal(accepted.length, 0);

  client.emit(Events.MessageUpdate, continuation, {
    ...continuation,
    content: `${continuation.content}\nstatus: ready_for_review\ngit_commit: abc1234`,
  });
  await flushEvents();

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].nonce, "8e9a4d1ad7a55e7d5bd23685");
  assert.equal(accepted[0].status, "ready_for_review");
});
