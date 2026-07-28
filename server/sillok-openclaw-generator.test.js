const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseOpenClawAgentOutput,
  createOpenClawSummaryGenerator,
} = require("./sillok-openclaw-generator");

test("extracts JSON and actual model metadata from OpenClaw output", () => {
  const parsed = parseOpenClawAgentOutput(JSON.stringify({
    result: {
      payloads: [{ text: "```json\n{\"title\":\"제목\",\"summary\":\"하나. 둘. 셋.\"}\n```" }],
      meta: { agentMeta: { provider: "openai", model: "gpt-5.6-sol" } },
    },
  }));
  assert.deepEqual(parsed, {
    title: "제목",
    summary: "하나. 둘. 셋.",
    model: "openai/gpt-5.6-sol",
  });
});

test("runs an isolated OpenClaw Agent session from a protected temporary prompt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sillok-generator-test-"));
  let invocation;
  const generator = createOpenClawSummaryGenerator({
    tempRoot: root,
    run: async (command, args) => {
      const promptPath = args[args.indexOf("--message-file") + 1];
      invocation = { command, args, prompt: fs.readFileSync(promptPath, "utf8"), promptPath };
      return {
        stdout: JSON.stringify({
          result: {
            payloads: [{ text: "{\"title\":\"KIA 일정\",\"summary\":\"범위를 확인했다. 일정을 정했다. 다음 점검을 남겼다.\"}" }],
            meta: { agentMeta: { provider: "openai", model: "gpt-5.6-sol" } },
          },
        }),
      };
    },
  });
  const result = await generator({
    system: "system rules",
    user: "bounded context and transcript",
    metadata: { recordId: "record-1" },
  });
  assert.equal(invocation.command, "openclaw");
  assert.match(invocation.args.join(" "), /agent:main:sillok-summary-record-1/);
  assert.match(invocation.prompt, /Do not call tools|bounded context/);
  assert.equal(fs.existsSync(invocation.promptPath), false);
  assert.equal(result.model, "openai/gpt-5.6-sol");
  fs.rmSync(root, { recursive: true, force: true });
});
