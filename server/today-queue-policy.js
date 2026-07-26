function parseGitCommitDeclaration(rawMarker) {
  const text = String(rawMarker || "").replace(/\r/g, "");
  const match = text.match(/^\s*git_commit\s*:\s*(.+)$/im);
  if (!match) return null;

  const value = match[1].trim();
  const shaMatch = value.match(/^([0-9a-f]{7,40})(?:\s+.*)?$/i);
  if (shaMatch) {
    return { type: "commit", sha: shaMatch[1].toLowerCase(), value };
  }

  const notApplicableMatch = value.match(/^not_applicable\s*:\s*(.+)$/i);
  if (notApplicableMatch && notApplicableMatch[1].trim()) {
    return {
      type: "not_applicable",
      reason: notApplicableMatch[1].trim(),
      value,
    };
  }

  return { type: "invalid", value };
}

function validateGitCommitDeclaration(rawMarker) {
  const declaration = parseGitCommitDeclaration(rawMarker);
  if (!declaration) {
    return { valid: false, reason: "git_commit_missing", declaration: null };
  }
  if (declaration.type === "invalid") {
    return { valid: false, reason: "git_commit_invalid", declaration };
  }
  return { valid: true, reason: null, declaration };
}

module.exports = {
  parseGitCommitDeclaration,
  validateGitCommitDeclaration,
};
