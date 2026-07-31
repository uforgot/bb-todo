#!/usr/bin/env node
const path = require("node:path");
const Database = require("better-sqlite3");
const { collectMeetingPipelineDiagnostics } = require("./meeting-pipeline-observability");

function parseArgs(argv) {
  const options = {
    dbPath: path.join(__dirname, "cron.db"),
    minMinutes: 60,
    limit: 50,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") options.dbPath = path.resolve(argv[++index] || "");
    else if (arg === "--min-minutes") options.minMinutes = Number(argv[++index]);
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.dbPath || !Number.isFinite(options.minMinutes) || options.minMinutes < 0) {
    throw new Error("usage: sillok-pipeline-diagnostics.js [--db path] [--min-minutes number] [--limit number]");
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = new Database(options.dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = collectMeetingPipelineDiagnostics(db, {
      minDurationSeconds: options.minMinutes * 60,
      limit: options.limit,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`[sillok-pipeline-diagnostics] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs };
