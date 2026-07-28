const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertLocator, readResultFile } = require("./sillok-summary-ops");

test("accepts a bounded current job locator", () => {
  assert.doesNotThrow(() => assertLocator("job-123", "attempt-456", "nonce_value_789"));
  assert.throws(() => assertLocator("../job", "attempt-456", "short"), /invalid Sillok job locator/);
});

test("reads only protected Sillok result files from the temp directory", () => {
  const file = path.join(os.tmpdir(), `sillok-summary-result-test-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({
    title: "공유 기억 제목",
    summary: "첫 문장이다. 둘째 문장이다. 셋째 문장이다.",
    model: "openai/gpt-5.6-sol",
  }), { mode: 0o600 });
  const loaded = readResultFile(file);
  assert.equal(loaded.value.title, "공유 기억 제목");
  fs.rmSync(file, { force: true });
  assert.throws(() => readResultFile(path.join(process.cwd(), "package.json")), /system temp directory/);
});
