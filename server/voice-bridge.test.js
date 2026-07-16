/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildVoiceRequestText,
  createSettledMessageBuffer,
  createVoiceFinalMarker,
  extractMarkedVoiceFinal,
  findVoiceFinalMarker,
} = require("./voice-bridge");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const value = (id, content, extra = {}) => ({
  message: { id, content },
  bot: { key: "bbangbbang" },
  requestId: "request-1",
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
  }), true);
  await wait(15);
  assert.equal(settled.length, 0);
  await wait(15);

  assert.equal(settled.length, 1);
  assert.equal(settled[0].message.content, "latest");
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
  });
  await wait(5);
  buffer.start(value("final", "complete"));
  await wait(30);

  assert.equal(settled.length, 1);
  assert.equal(settled[0].message.id, "final");
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



test("creates, finds, and strips a request-specific final marker", () => {
  const marker = createVoiceFinalMarker();
  assert.match(marker, /^\(BBVOICE_FINAL:[A-F0-9]{8}\)$/);
  assert.equal(findVoiceFinalMarker(`prompt ${marker}`), marker);
  assert.equal(extractMarkedVoiceFinal(`[calm] 최종 답변이야. ${marker}`, marker), "[calm] 최종 답변이야.");
  assert.equal(extractMarkedVoiceFinal(`${marker} 아직 작성 중이야.`, marker), null);
  assert.equal(extractMarkedVoiceFinal(`중간에 ${marker} 있지만 아직 작성 중이야.`, marker), null);
  assert.equal(extractMarkedVoiceFinal("Working. Read: todo skill", marker), null);
});

test("adds the exact final marker instruction only when requested", async () => {
  const marker = "(BBVOICE_FINAL:12AB34CD)";
  const marked = await buildVoiceRequestText("테스트", { finalMarker: marker });
  const unmarked = await buildVoiceRequestText("테스트");

  assert.equal(marked.includes(`End only the final answer with this exact marker: ${marker}`), true);
  assert.equal(marked.includes("make it the final characters"), true);
  assert.equal(unmarked.includes("BBVOICE_FINAL"), false);
});
