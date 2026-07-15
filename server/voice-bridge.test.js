/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSettledMessageBuffer } = require("./voice-bridge");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const value = (id, content, extra = {}) => ({
  message: { id, content },
  bot: { key: "bbangbbang" },
  requestId: "request-1",
  wasEdited: false,
  ...extra,
});

test("publishes one settled non-streaming message", async () => {
  const settled = [];
  const buffer = createSettledMessageBuffer({
    delayMs: 15,
    onSettle: async (item) => settled.push(item),
  });

  buffer.start(value("1", "final answer"));
  await wait(25);

  assert.equal(settled.length, 1);
  assert.equal(settled[0].message.content, "final answer");
  assert.equal(buffer.has(), false);
});

test("message updates reset settling and keep the latest draft", async () => {
  const settled = [];
  const buffer = createSettledMessageBuffer({
    delayMs: 20,
    onSettle: async (item) => settled.push(item),
  });

  buffer.start(value("1", "first"));
  await wait(10);
  assert.equal(buffer.update("1", {
    message: { id: "1", content: "latest" },
    wasEdited: true,
  }), true);
  await wait(15);
  assert.equal(settled.length, 0);
  await wait(15);

  assert.equal(settled.length, 1);
  assert.equal(settled[0].message.content, "latest");
  assert.equal(settled[0].wasEdited, true);
});

test("a new final message replaces an in-flight progress draft", async () => {
  const settled = [];
  const buffer = createSettledMessageBuffer({
    delayMs: 20,
    onSettle: async (item) => settled.push(item),
  });

  buffer.start(value("progress", "working"));
  buffer.update("progress", {
    message: { id: "progress", content: "still working" },
    wasEdited: true,
  });
  await wait(5);
  buffer.start(value("final", "complete"));
  await wait(30);

  assert.equal(settled.length, 1);
  assert.equal(settled[0].message.id, "final");
  assert.equal(settled[0].wasEdited, false);
});

test("clear cancels a pending message", async () => {
  const settled = [];
  const buffer = createSettledMessageBuffer({
    delayMs: 10,
    onSettle: async (item) => settled.push(item),
  });

  buffer.start(value("1", "cancel me"));
  buffer.clear();
  await wait(20);

  assert.deepEqual(settled, []);
});
