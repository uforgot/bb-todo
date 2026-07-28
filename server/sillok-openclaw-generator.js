const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile: execFileCallback } = require("node:child_process");
const { promisify } = require("node:util");

const execFile = promisify(execFileCallback);

function parseJsonText(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("OpenClaw summary output is not an object");
  return parsed;
}

function parseOpenClawAgentOutput(stdout) {
  const envelope = JSON.parse(String(stdout || ""));
  const text = envelope?.result?.payloads?.find(payload => typeof payload?.text === "string")?.text;
  if (!text) throw new Error("OpenClaw Agent returned no text payload");
  const result = parseJsonText(text);
  const meta = envelope?.result?.meta?.agentMeta || {};
  return {
    ...result,
    model: meta.provider && meta.model ? `${meta.provider}/${meta.model}` : result.model,
  };
}

function safeSessionPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

function createOpenClawSummaryGenerator({
  command = "openclaw",
  agentId = "main",
  timeoutSeconds = 180,
  thinking = "medium",
  run = execFile,
  tempRoot = os.tmpdir(),
} = {}) {
  return async ({ system, user, metadata = {} }) => {
    const dir = fs.mkdtempSync(path.join(tempRoot, "sillok-agent-"));
    const promptPath = path.join(dir, "prompt.txt");
    const prompt = [
      system,
      "",
      "The following data was already bounded and selected by the Sillok handler.",
      "Do not call tools or read other files. Return only the requested JSON object.",
      "",
      user,
    ].join("\n");
    fs.writeFileSync(promptPath, prompt, { mode: 0o600 });
    try {
      const sessionKey = `agent:${agentId}:sillok-summary-${safeSessionPart(metadata.jobId || metadata.recordId)}`;
      const { stdout } = await run(command, [
        "agent",
        "--agent", agentId,
        "--session-key", sessionKey,
        "--message-file", promptPath,
        "--json",
        "--timeout", String(timeoutSeconds),
        "--thinking", thinking,
      ], {
        timeout: (timeoutSeconds + 15) * 1000,
        maxBuffer: 8 * 1024 * 1024,
        env: process.env,
      });
      return parseOpenClawAgentOutput(stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

module.exports = {
  parseOpenClawAgentOutput,
  createOpenClawSummaryGenerator,
};
