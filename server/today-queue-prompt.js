const DEFAULT_LIMIT = 1950;
const TRUNCATION_NOTICE = "… [두두 item content가 길어서 Discord dispatch 메시지에서 일부 생략됨]";

function joinLines(lines) {
  return lines
    .filter(line => line !== null && line !== undefined)
    .map(String)
    .join("\n");
}

function truncateBody(text, maxLength) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  if (maxLength <= TRUNCATION_NOTICE.length) return TRUNCATION_NOTICE.slice(0, maxLength);
  return `${value.slice(0, maxLength - TRUNCATION_NOTICE.length - 2).trim()}\n\n${TRUNCATION_NOTICE}`;
}

function buildBoundedDiscordPrompt({ beforeLines, body, afterLines, limit = DEFAULT_LIMIT }) {
  const before = joinLines(beforeLines);
  const after = joinLines(afterLines);
  const fixedLength = before.length + after.length + 2;
  const availableBodyLength = Math.max(0, limit - fixedLength);
  const fittedBody = truncateBody(body, availableBodyLength);
  const content = `${before}\n${fittedBody}\n${after}`;
  if (content.length > limit) {
    throw new Error(`Discord prompt exceeds ${limit} characters after truncation`);
  }
  return content;
}

module.exports = {
  DEFAULT_LIMIT,
  TRUNCATION_NOTICE,
  buildBoundedDiscordPrompt,
  truncateBody,
};
