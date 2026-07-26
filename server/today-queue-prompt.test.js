/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_LIMIT,
  TRUNCATION_NOTICE,
  buildBoundedDiscordPrompt,
} = require("./today-queue-prompt");

test("keeps short task content unchanged", () => {
  const content = buildBoundedDiscordPrompt({
    beforeLines: ["mention", "[task_content]"],
    body: "short body",
    afterLines: ["[rules]", "rule", "DUDU_RESULT_V1"],
  });

  assert.match(content, /short body/);
  assert.equal(content.includes(TRUNCATION_NOTICE), false);
  assert.ok(content.length <= DEFAULT_LIMIT);
});

test("truncates only task content while preserving rules and result marker", () => {
  const content = buildBoundedDiscordPrompt({
    beforeLines: ["mention", "[task_content]"],
    body: "긴 내용".repeat(2000),
    afterLines: ["[rules]", "critical rule", "DUDU_RESULT_V1", "nonce: abc"],
  });

  assert.ok(content.length <= DEFAULT_LIMIT);
  assert.match(content, new RegExp(TRUNCATION_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(content, /critical rule/);
  assert.match(content, /DUDU_RESULT_V1/);
  assert.match(content, /nonce: abc/);
});
