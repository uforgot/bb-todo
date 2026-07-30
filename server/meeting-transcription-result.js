function getUsableTranscript(result) {
  const hasSpokenWords = Array.isArray(result?.words)
    && result.words.some(item => item?.type === "word" && String(item?.text || "").trim());
  return hasSpokenWords ? String(result?.text || "").trim() : "";
}

module.exports = { getUsableTranscript };
