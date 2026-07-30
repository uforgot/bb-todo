const test = require("node:test");
const assert = require("node:assert/strict");
const { getUsableTranscript } = require("./meeting-transcription-result");

test("returns a trimmed Scribe transcript when it contains speech", () => {
  assert.equal(getUsableTranscript({
    text: "  안녕하세요.  ",
    words: [{ type: "word", text: "안녕하세요." }],
  }), "안녕하세요.");
});

test("returns an empty string when Scribe captured no text", () => {
  assert.equal(getUsableTranscript({ text: "   \n\t ", words: [] }), "");
  assert.equal(getUsableTranscript({}), "");
  assert.equal(getUsableTranscript(null), "");
});

test("treats audio events without spoken words as an empty transcript", () => {
  assert.equal(getUsableTranscript({
    text: "[mouse clicking]",
    words: [{ type: "audio_event", text: "[mouse clicking]" }],
  }), "");
});
