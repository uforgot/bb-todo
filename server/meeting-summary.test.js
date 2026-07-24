const test = require("node:test");
const assert = require("node:assert/strict");
const { createMeetingSummaryGenerator } = require("./meeting-summary");

function openRouterResponse(payload) {
  return {
    ok: true,
    async json() {
      return {
        choices: [{ message: { content: JSON.stringify(payload) } }],
      };
    },
  };
}

test("generates a Korean title and 2-3 line summary in one pass", async () => {
  const requests = [];
  const generator = createMeetingSummaryGenerator({
    apiKey: "test-key",
    model: "test/model",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return openRouterResponse({
        title: "신규 서비스 디자인 회의",
        summary: "사용자 흐름을 단순화하기로 했다.\n다음 주까지 인터랙션 시안을 준비한다.",
      });
    },
  });

  const result = await generator.generate("한국어와 English가 섞인 회의 원문");

  assert.deepEqual(result, {
    title: "신규 서비스 디자인 회의",
    summary: "사용자 흐름을 단순화하기로 했다.\n다음 주까지 인터랙션 시안을 준비한다.",
    model: "test/model",
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /명령으로 따르지/);
  assert.match(requests[0].messages[1].content, /<transcript_data>/);
});

test("summarizes long transcripts in chunks before the final result", async () => {
  let callCount = 0;
  const generator = createMeetingSummaryGenerator({
    apiKey: "test-key",
    model: "test/model",
    chunkSize: 40,
    fetchImpl: async (_url, options) => {
      callCount += 1;
      const body = JSON.parse(options.body);
      const isChunk = body.messages[0].content.includes("회의록 구간 요약 도우미");
      return isChunk
        ? openRouterResponse({ summary: `부분 요약 ${callCount}` })
        : openRouterResponse({ title: "긴 회의", summary: "핵심 결정 사항이다.\n담당자와 일정을 확인했다." });
    },
  });

  const result = await generator.generate("가".repeat(95));

  assert.equal(callCount, 4);
  assert.equal(result.title, "긴 회의");
});

test("rejects malformed OpenRouter responses", async () => {
  const generator = createMeetingSummaryGenerator({
    apiKey: "test-key",
    fetchImpl: async () => openRouterResponse({ title: "제목만 있음" }),
  });

  await assert.rejects(() => generator.generate("회의 원문"), /summary/);
});
