const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const weatherPath = path.join(os.tmpdir(), `bb-weather-test-${process.pid}.json`);
process.env.BB_WEATHER_CACHE_PATH = weatherPath;
const {
  normalizeLocation,
  buildTimeLabel,
  readWeatherSnapshot,
} = require("./recording-context");

test.after(() => fs.rmSync(weatherPath, { force: true }));

test("normalizes optional recording location without inventing values", () => {
  assert.deepEqual(normalizeLocation({ lat: "37.5", lng: "126.9", accuracy: "42", ts: "2026-07-28T07:00:00.000Z" }), {
    lat: 37.5,
    lng: 126.9,
    accuracy: 42,
    ts: "2026-07-28T07:00:00.000Z",
  });
  assert.equal(normalizeLocation({ lat: 91, lng: 126.9 }), null);
  assert.equal(normalizeLocation({ lat: 37.5 }), null);
});

test("formats recording time from the persisted timestamp in Korea time", () => {
  assert.equal(
    buildTimeLabel("2026-07-28T07:08:00.000Z"),
    "2026년 7월 28일 화요일 오후 16:08"
  );
});

test("returns only a bounded fresh weather snapshot", () => {
  fs.writeFileSync(weatherPath, JSON.stringify({ updated_at: 1785222000, temp_c: 29.2, desc: "흐림", city: "Seoul" }));
  assert.deepEqual(readWeatherSnapshot(1785225600000), {
    label: "29도, 흐림 (서울)",
    observedAt: "2026-07-28T07:00:00.000Z",
  });
  assert.equal(readWeatherSnapshot(1785250000000), null);
});
