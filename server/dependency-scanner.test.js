const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  addWatchMetadata,
  classifyUpdate,
  cleanReleasePreview,
  discoverManifestPaths,
  parseInsightResponse,
  readNpmManifest,
  readPyPIManifest,
} = require("./dependency-scanner");

test("classifyUpdate distinguishes semantic version changes", () => {
  assert.equal(classifyUpdate("1.2.3", "2.0.0"), "major");
  assert.equal(classifyUpdate("1.2.3", "1.3.0"), "minor");
  assert.equal(classifyUpdate("1.2.3", "1.2.4"), "patch");
  assert.equal(classifyUpdate("1.2.3", "1.2.3"), "none");
  assert.equal(classifyUpdate(null, "1.2.3"), "unknown");
});

test("manifest discovery ignores dependency and build directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-scan-"));
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  fs.mkdirSync(path.join(root, "python"));
  fs.writeFileSync(path.join(root, "python", "requirements.txt"), "httpx==0.28.1\n");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "package.json"), "{}");

  assert.deepEqual(
    discoverManifestPaths([root]).map((entry) => path.relative(root, entry)),
    ["package.json", path.join("python", "requirements.txt")],
  );
});

test("NPM parser prefers package-lock resolved versions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npm-manifest-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    dependencies: { react: "^19.0.0" },
    devDependencies: { typescript: "^5" },
  }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({
    packages: {
      "node_modules/react": { version: "19.2.4" },
      "node_modules/typescript": { version: "5.9.3" },
    },
  }));

  const dependencies = readNpmManifest(path.join(root, "package.json"));
  assert.equal(dependencies.find((entry) => entry.name === "react").currentVersion, "19.2.4");
  assert.equal(dependencies.find((entry) => entry.name === "typescript").currentVersion, "5.9.3");
});

test("PyPI parser handles pinned and ranged requirements", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pypi-manifest-"));
  const manifestPath = path.join(root, "requirements.txt");
  fs.writeFileSync(manifestPath, "httpx==0.28.1\nfastapi>=0.110,<1\n-r dev.txt\n");

  const dependencies = readPyPIManifest(manifestPath);
  assert.deepEqual(dependencies.map(({ name, currentVersion }) => ({ name, currentVersion })), [
    { name: "httpx", currentVersion: "0.28.1" },
    { name: "fastapi", currentVersion: "0.110" },
  ]);
});

test("release preview removes markdown noise", () => {
  const preview = cleanReleasePreview("## What's Changed\n* Added [voice streaming](https://example.com)\n**Full Changelog**: https://example.com/all");
  assert.equal(preview, "What's Changed Added voice streaming");
});

test("AI insight parser accepts nested arrays", () => {
  assert.equal(
    parseInsightResponse("```json\n{\"insights\":[{\"key\":\"npm:openclaw\",\"insight\":\"bb-app 음성 흐름 검증이 필요해.\"}]}\n```")["npm:openclaw"],
    "bb-app 음성 흐름 검증이 필요해.",
  );
});

test("watch metadata stars existing entries and adds missing interests", () => {
  const watched = [
    { ecosystem: "npm", name: "openclaw", displayName: "OpenClaw", githubRepo: "openclaw/openclaw", relevanceContext: "에이전트" },
    { ecosystem: "pypi", name: "insightface", displayName: "InsightFace", githubRepo: "deepinsight/insightface", relevanceContext: "얼굴 인식" },
  ];
  const dependencies = addWatchMetadata([
    {
      ecosystem: "npm",
      name: "openclaw",
      currentVersion: "2026.7.2",
      declaredVersion: "2026.7.2",
      manifest: "package.json",
      group: "dependencies",
    },
  ], watched, (_, name) => name === "insightface" ? "0.7.3" : null);

  assert.equal(dependencies.length, 2);
  assert.equal(dependencies[0].isWatched, true);
  assert.equal(dependencies[0].displayName, "OpenClaw");
  assert.deepEqual(dependencies[1], {
    ecosystem: "pypi",
    name: "insightface",
    displayName: "InsightFace",
    githubRepo: "deepinsight/insightface",
    relevanceContext: "얼굴 인식",
    declaredVersion: "watched",
    currentVersion: "0.7.3",
    group: "watched",
    manifest: "관심 목록",
    isWatched: true,
  });
});
