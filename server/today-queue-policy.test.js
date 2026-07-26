/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseGitCommitDeclaration,
  validateGitCommitDeclaration,
} = require("./today-queue-policy");

test("accepts a git commit SHA declaration", () => {
  const raw = [
    "DUDU_RESULT_V1",
    "status: ready_for_review",
    "git_commit: a1B2c3D Add queue policy",
  ].join("\n");

  assert.deepEqual(parseGitCommitDeclaration(raw), {
    type: "commit",
    sha: "a1b2c3d",
    value: "a1B2c3D Add queue policy",
  });
  assert.equal(validateGitCommitDeclaration(raw).valid, true);
});

test("accepts an indented YAML git commit declaration", () => {
  const raw = [
    "DUDU_RESULT_V1:",
    "  status: ready_for_review",
    "  git_commit: a1B2c3D",
  ].join("\n");

  assert.equal(validateGitCommitDeclaration(raw).valid, true);
});

test("accepts not_applicable only with a reason", () => {
  const valid = validateGitCommitDeclaration(
    "DUDU_RESULT_V1\ngit_commit: not_applicable: research-only task; no repository files changed",
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.declaration.type, "not_applicable");

  const invalid = validateGitCommitDeclaration(
    "DUDU_RESULT_V1\ngit_commit: not_applicable",
  );
  assert.deepEqual(invalid, {
    valid: false,
    reason: "git_commit_invalid",
    declaration: { type: "invalid", value: "not_applicable" },
  });
});

test("rejects a missing or malformed declaration", () => {
  assert.deepEqual(validateGitCommitDeclaration("DUDU_RESULT_V1"), {
    valid: false,
    reason: "git_commit_missing",
    declaration: null,
  });
  assert.equal(
    validateGitCommitDeclaration("DUDU_RESULT_V1\ngit_commit: finished").reason,
    "git_commit_invalid",
  );
});
