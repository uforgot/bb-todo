#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const plist = require("simple-plist");
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

async function request(pathname, method = "GET") {
  if (!apiKey) throw new Error("USAGE_API_KEY is required");
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: { Authorization: "Bearer " + apiKey },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${body?.error_code || response.status}: ${body?.error || "request failed"}`);
  return body;
}

async function main() {
  const [command = "list", jobId] = process.argv.slice(2);
  let result;
  if (command === "list") {
    result = await request("/api/meeting-summary-jobs?status=all&limit=200");
  } else if (command === "pending") {
    result = await request("/api/meeting-summary-jobs?status=pending&limit=200");
  } else if (command === "retry") {
    if (!jobId) throw new Error("usage: sillok-summary-ops.js retry <job-id>");
    result = await request(`/api/meeting-summary-jobs/${encodeURIComponent(jobId)}/retry`, "POST");
  } else if (command === "reconcile") {
    result = await request("/api/meeting-summary-jobs/reconcile", "POST");
  } else {
    throw new Error("usage: sillok-summary-ops.js [list|pending|retry <job-id>|reconcile]");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  console.error(`[sillok-summary-ops] ${error.message}`);
  process.exitCode = 1;
});
