const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { MEETING_LIST_COLUMNS, MEETING_LIST_QUERY } = require("./meeting-list-query");

const HEAVY_COLUMNS = [
  "transcript",
  "transcription_words_json",
  "transcription_segments_json",
  "transcription_options_json",
];

test("meeting list projection excludes transcript detail payloads", () => {
  for (const column of HEAVY_COLUMNS) {
    assert.equal(MEETING_LIST_COLUMNS.includes(column), false);
  }
  for (const column of ["id", "record_number", "summary", "transcription_status", "summary_status"]) {
    assert.equal(MEETING_LIST_COLUMNS.includes(column), true);
  }
});

test("meeting list query does not read large transcript columns", () => {
  const db = new Database(":memory:");
  const definitions = [
    ...MEETING_LIST_COLUMNS.map(column => `${column} TEXT`),
    ...HEAVY_COLUMNS.map(column => `${column} TEXT`),
  ];
  db.exec(`CREATE TABLE meetings (${definitions.join(", ")})`);
  db.prepare(`
    INSERT INTO meetings (
      id, record_number, summary, transcription_status, summary_status,
      transcript, transcription_words_json, transcription_segments_json, transcription_options_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("record-1", "1", "요약", "completed", "completed", "원문", "[1]", "[2]", "{\"x\":1}");

  const row = db.prepare(MEETING_LIST_QUERY).get(50);
  assert.equal(row.id, "record-1");
  for (const column of HEAVY_COLUMNS) assert.equal(row[column], undefined);
  db.close();
});
