const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const {
  byteLength,
  classifyPipelineError,
  collectMeetingPipelineDiagnostics,
  createMeetingPipelineStage,
} = require("./meeting-pipeline-observability");

function createFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      record_number INTEGER,
      duration_seconds REAL,
      size_bytes INTEGER,
      transcription_status TEXT,
      transcription_attempts INTEGER,
      transcription_error TEXT,
      summary_status TEXT,
      summary_error TEXT,
      transcript TEXT,
      transcription_words_json TEXT,
      transcription_segments_json TEXT,
      recorded_at TEXT,
      transcription_updated_at TEXT,
      summary_updated_at TEXT
    );
    CREATE TABLE meeting_summary_jobs (
      id TEXT PRIMARY KEY,
      record_id TEXT,
      generation INTEGER,
      status TEXT
    );
    CREATE TABLE meeting_summary_attempts (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      attempt INTEGER,
      status TEXT,
      error_code TEXT,
      error TEXT,
      created_at TEXT,
      dispatched_at TEXT,
      acknowledged_at TEXT,
      finished_at TEXT
    );
  `);
  const longWords = "w".repeat(5 * 1024 * 1024);
  db.prepare(`
    INSERT INTO meetings VALUES (
      'long-record', 30, 9374, 76079803,
      'completed', 1, NULL, 'completed', NULL,
      ?, ?, ?, '2026-07-30T04:57:17.293Z',
      '2026-07-30T09:53:11.000Z', '2026-07-30T09:55:42.937Z'
    )
  `).run("t".repeat(69641), longWords, "s".repeat(169661));
  db.prepare("INSERT INTO meeting_summary_jobs VALUES ('job-1','long-record',1,'completed')").run();
  db.prepare(`
    INSERT INTO meeting_summary_attempts VALUES (
      'attempt-1','job-1',1,'failed','agent_ack_timeout','OpenClaw Agent acknowledgement timed out',
      '2026-07-30T09:50:00.000Z','2026-07-30T09:50:00.500Z',NULL,'2026-07-30T09:52:15.000Z'
    )
  `).run();
  db.prepare(`
    INSERT INTO meeting_summary_attempts VALUES (
      'attempt-2','job-1',2,'completed',NULL,NULL,
      '2026-07-30T09:53:17.000Z','2026-07-30T09:53:17.500Z','2026-07-30T09:55:29.500Z','2026-07-30T09:55:42.900Z'
    )
  `).run();
  return db;
}

test("emits bounded structured stage metrics without payload content", () => {
  const lines = [];
  let currentTime = 1_000;
  const logger = {
    log: line => lines.push(line),
    error: line => lines.push(line),
  };
  const stage = createMeetingPipelineStage({
    meetingId: "record-1",
    stage: "transcription_store",
    logger,
    now: () => currentTime,
    metadata: { duration_seconds: 5400 },
  });
  currentTime = 1_125;
  const metric = stage.complete({ transcript_chars: 42000, words_bytes: 3_000_000 });
  assert.equal(metric.elapsed_ms, 125);
  assert.equal(metric.status, "completed");
  assert.match(lines[0], /^\[meeting-pipeline\] /);
  assert.doesNotMatch(lines[0], /transcript_text/);
});

test("classifies timeout, SQLite locking, and upstream failures", () => {
  assert.equal(classifyPipelineError(new Error("Scribe transcription timed out")), "timeout");
  assert.equal(classifyPipelineError(Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" })), "sqlite_busy");
  assert.equal(classifyPipelineError(new Error("Scribe 503: unavailable")), "upstream_unavailable");
});

test("diagnoses a 156-minute fixture without loading its 5 MB words payload", () => {
  const db = createFixture();
  try {
    const report = collectMeetingPipelineDiagnostics(db, { minDurationSeconds: 3600 });
    assert.equal(report.record_count, 1);
    const [record] = report.records;
    assert.equal(record.duration_seconds, 9374);
    assert.equal(record.words_bytes, 5 * 1024 * 1024);
    assert.equal(record.transcription.attempts, 1);
    assert.equal(record.transcription.status, "completed");
    assert.deepEqual(record.summary.failure_codes, ["agent_ack_timeout"]);
    assert.equal(record.summary.attempts[1].acknowledgement_seconds, 132);
    assert.equal(record.diagnosis, "summary_agent_ack_timeout_recovered");
  } finally {
    db.close();
  }
});

test("byteLength measures UTF-8 payload bytes", () => {
  assert.equal(byteLength("실록"), 6);
  assert.equal(byteLength({ ok: true }), 11);
});
