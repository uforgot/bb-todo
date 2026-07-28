#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const plist = require("simple-plist");
const {
  collectMemoryContext,
  buildAgentTranscript,
  buildSummaryPrompt,
  validateGeneratedSummary,
} = require("./sillok-summary-handler");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
require("dotenv").config({ path: path.join(os.homedir(), ".openclaw", ".env"), quiet: true });

function readLaunchAgentApiKey() {
  try {
    const file = path.join(os.homedir(), "Library", "LaunchAgents", "com.bbtodo.usage-server.plist");
    return plist.parse(fs.readFileSync(file, "utf8"))?.EnvironmentVariables?.USAGE_API_KEY || "";
  } catch {
    return "";
  }
}

const baseUrl = process.env.SILLOK_API_BASE_URL || "http://127.0.0.1:3100";
const apiKey = process.env.SILLOK_API_KEY || readLaunchAgentApiKey() || process.env.USAGE_API_KEY;

async function request(pathname, { method = "GET", body } = {}) {
  if (!apiKey) throw new Error("USAGE_API_KEY is required");
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      Authorization: "Bearer " + apiKey,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${payload?.error_code || response.status}: ${payload?.error || "request failed"}`);
  return payload;
}

function assertLocator(jobId, attemptId, nonce) {
  const id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/;
  if (!id.test(jobId || "") || !id.test(attemptId || "") || !/^[a-zA-Z0-9_-]{8,128}$/.test(nonce || "")) {
    throw new Error("invalid Sillok job locator");
  }
}

async function prepareAgentTurn(jobId, attemptId, nonce) {
  assertLocator(jobId, attemptId, nonce);
  const claim = await request(`/api/meeting-summary-jobs/${jobId}/claim`, {
    method: "POST",
    body: {
      attempt_id: attemptId,
      nonce,
      schema_version: 1,
      agent: "bbangbbang-discord",
    },
  });
  const meeting = await request(claim.transcript_url);
  const transcript = buildAgentTranscript(meeting);
  if (!transcript.trim()) throw new Error("meeting transcript is empty");
  const context = collectMemoryContext({ transcript });
  const prompt = buildSummaryPrompt({
    transcript,
    context,
    recordingContext: meeting?.context,
    recordNumber: claim.record_number,
  });
  return {
    schema: "SILLOK_AGENT_TURN_V1",
    job_id: jobId,
    record_id: claim.record_id,
    record_number: claim.record_number,
    attempt_id: attemptId,
    nonce,
    context: { kind: context.kind, project: context.project },
    prompt: { system: prompt.system, user: prompt.user },
    required_result: {
      title: "80자 이내 한국어 제목",
      summary: "AI 의견 없이 기록의 사실과 흐름만 담은 독립적인 한국어 요약 3~6문장",
      feedback: "bb-write에서 신빵에게 직접 건네는 빵빵의 자유로운 반말 피드백",
      speaker_names: "확실히 식별한 transcript speaker ID만 신빵으로 매핑; 아니면 빈 객체",
      model: "현재 OpenClaw 세션의 provider/model",
    },
  };
}

function readResultFile(filePath) {
  const resolved = path.resolve(filePath || "");
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith("sillok-summary-result-")) {
    throw new Error("result file must be a sillok-summary-result-* file inside the system temp directory");
  }
  return { resolved, value: JSON.parse(fs.readFileSync(resolved, "utf8")) };
}

async function completeAgentTurn(jobId, attemptId, nonce, filePath) {
  assertLocator(jobId, attemptId, nonce);
  const { resolved, value } = readResultFile(filePath);
  const validated = validateGeneratedSummary(value);
  const model = String(value?.model || "").trim().slice(0, 120);
  if (!model) throw new Error("result model is required");
  try {
    return await request(`/api/meeting-summary-jobs/${jobId}/result`, {
      method: "POST",
      body: {
        attempt_id: attemptId,
        nonce,
        schema_version: 1,
        title: validated.title,
        summary: validated.summary,
        speaker_names: validated.speakerNames,
        model,
        agent: "bbangbbang-discord",
        context_mode: "openclaw_memory",
      },
    });
  } finally {
    fs.rmSync(resolved, { force: true });
  }
}

async function failAgentTurn(jobId, attemptId, nonce, code = "discord_agent_failed") {
  assertLocator(jobId, attemptId, nonce);
  return request(`/api/meeting-summary-jobs/${jobId}/fail`, {
    method: "POST",
    body: {
      attempt_id: attemptId,
      nonce,
      error_code: String(code).slice(0, 80),
      error: "Discord Agent turn failed before result writeback",
      retryable: true,
    },
  });
}

async function main() {
  const [command = "list", ...args] = process.argv.slice(2);
  let result;
  if (command === "list") {
    result = await request("/api/meeting-summary-jobs?status=all&limit=200");
  } else if (command === "pending") {
    result = await request("/api/meeting-summary-jobs?status=pending&limit=200");
  } else if (command === "retry") {
    if (!args[0]) throw new Error("usage: sillok-summary-ops.js retry <job-id>");
    result = await request(`/api/meeting-summary-jobs/${encodeURIComponent(args[0])}/retry`, { method: "POST" });
  } else if (command === "reconcile") {
    result = await request("/api/meeting-summary-jobs/reconcile", { method: "POST" });
  } else if (command === "regenerate") {
    if (!args[0]) throw new Error("usage: sillok-summary-ops.js regenerate <record-number-or-id> [trigger]");
    const listing = await request("/api/meetings");
    const meetings = Array.isArray(listing) ? listing : listing?.meetings || [];
    const meeting = meetings.find(item => item.id === args[0] || String(item.record_number) === String(args[0]));
    if (!meeting) throw new Error(`Sillok record not found: ${args[0]}`);
    result = await request(`/api/meetings/${encodeURIComponent(meeting.id)}/summary/agent`, {
      method: "POST",
      body: { trigger: args[1] || "manual_discord_agent", regenerate: true },
    });
  } else if (command === "prepare") {
    result = await prepareAgentTurn(args[0], args[1], args[2]);
  } else if (command === "complete") {
    result = await completeAgentTurn(args[0], args[1], args[2], args[3]);
  } else if (command === "fail") {
    result = await failAgentTurn(args[0], args[1], args[2], args[3]);
  } else {
    throw new Error("usage: sillok-summary-ops.js [list|pending|retry|reconcile|regenerate|prepare|complete|fail]");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[sillok-summary-ops] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertLocator,
  readResultFile,
  prepareAgentTurn,
  completeAgentTurn,
  failAgentTurn,
};
