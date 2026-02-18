# Usage 메뉴

> 하단 탭바 네 번째 탭 — 아이콘: `Activity`

---

## 개요

Claude (Anthropic Max Plan)와 Kimi (Moonshot) AI 서비스의 사용량을 한 화면에서 모니터링하는 대시보드.

---

## Claude 카드

Claude Usage Tracker 앱의 데이터를 수집해 표시.

| 항목 | 설명 |
|------|------|
| 플랜 | Max Plan 뱃지 |
| 현재 세션 | 세션 사용률 (%) + 재설정 카운트다운 |
| 주간 한도 / 모든 모델 | 전체 주간 토큰 사용률 + 재설정 일시 |
| 주간 한도 / Sonnet만 | Sonnet 전용 주간 사용률 |
| Opus | 사용 시에만 표시 (claude.ai 웹 직접 사용 시만 집계됨) |
| 마지막 업데이트 | 상대 시간 표시 (`3분 전`) + 새로고침 버튼 |

> ⚠️ **제한사항:** OpenClaw 경유 사용량은 집계되지 않음. claude.ai 웹 직접 사용량만 반영.

---

## Kimi 카드

Moonshot API의 잔액을 추적해 소비량을 계산.

| 항목 | 설명 |
|------|------|
| 현재 잔액 | 뱃지에 `$X.XX` 표시 |
| 월간 사용량 | 이번 달 누적 소비 금액 |
| 일별 소비 차트 | 최근 30일 막대 차트 |
| 마지막 충전 | 마지막 충전 감지 일시 |

### 충전 감지 로직

```
전날 잔액 - 오늘 잔액 = 소비량
오늘 잔액 > 전날 잔액 → 충전 이벤트 (event_type: "charge")
```

---

## 데이터 수집 흐름

```
매일 07:00 아침 브리핑 크론
    → scripts/update-usage-logs.sh 실행
        ├── check-kimi-balance.sh → Moonshot API
        └── Claude Usage Tracker 앱 preferences 파싱
    → backup/usage-logs.json 업데이트
    → 22:00 자동 백업 크론 → bb-samsara push
    → GitHub Contents API
    → /api/usage route (Next.js)
    → useUsage hook (SWR, 1분 캐시)
    → UsageSection 컴포넌트
```

---

## usage-logs.json 포맷

```json
{
  "logs": [
    {
      "provider": "kimi",
      "balance": 21.18,
      "consumed": 0.05,
      "hours_elapsed": 24.0,
      "event_type": "daily",
      "charge_amount": null,
      "recorded_at": "2026-02-19T07:00:00+09:00"
    }
  ],
  "summary": {
    "kimi": {
      "current_balance": 21.18,
      "monthly_consumed": 2.45,
      "last_charge": "2026-02-10T14:00:00+09:00",
      "currency": "USD"
    },
    "claude": {
      "plan": "Max",
      "weekly_tokens_used": 800000,
      "weekly_limit": 1000000,
      "weekly_percentage": 80,
      "sonnet_weekly_tokens_used": 590000,
      "sonnet_weekly_percentage": 59,
      "opus_weekly_tokens_used": 0,
      "opus_weekly_percentage": 0,
      "session_percentage": 38,
      "weekly_reset_time": "2026-02-21T08:00:00+09:00",
      "last_updated": "2026-02-19T07:00:00+09:00"
    }
  }
}
```

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/app/usage/page.tsx` | 페이지 |
| `src/app/api/usage/route.ts` | GitHub API 프록시 |
| `src/components/usage-section.tsx` | Claude + Kimi 카드 |
| `src/hooks/use-usage.ts` | SWR 데이터 훅 (1분 캐시) |
| `scripts/update-usage-logs.sh` | 데이터 수집 스크립트 |
| `bb-samsara/backup/usage-logs.json` | 사용량 데이터 파일 |
