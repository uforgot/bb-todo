# Cron 메뉴

> 하단 탭바 세 번째 탭 — 아이콘: `Timer`

---

## 개요

OpenClaw Gateway에 등록된 크론 잡 목록과 상태를 모니터링하는 뷰.

---

## 기능

| 기능 | 설명 |
|------|------|
| 크론 목록 | 등록된 모든 잡 카드 표시 |
| 상태 표시 | 마지막 실행 상태 (ok / error) |
| 다음 실행 | 다음 실행 예정 시각 |
| 마지막 실행 | 마지막 실행 시각 + 소요 시간 |
| 활성/비활성 | enabled 여부 뱃지 |

---

## 데이터 흐름

Gateway REST API가 없어 파일 기반 우회 방식 사용:

```
OpenClaw 22:00 크론
    → cron-jobs.json 생성
    → bb-samsara/backup/cron-jobs.json push
    → GitHub Contents API
    → /api/cron route (Next.js)
    → useCron hook (SWR, 1분 캐시)
    → CronSection 컴포넌트
```

> ⚠️ 실시간 데이터가 아님. 최대 24시간 지연 가능 (22:00 백업 기준).

---

## 등록된 크론 잡 목록

| 이름 | 스케줄 | 설명 |
|------|--------|------|
| 아침 브리핑 | 매일 07:00 | 날씨, 일정, 시스템 상태 |
| 저녁 브리핑 | 매일 18:00 | 내일 일정 요약 |
| 프론트엔드 뉴스 | 월/수/금 09:00 | 개발 뉴스 이메일 발송 |
| TODO 리마인드 | 금요일 19:00 | 미완료 항목 알림 |
| workspace 자동 정리 | 매일 22:00 | git commit + push |
| pp-samsara 자동 정리 | 매일 22:05 | 팡팡 workspace sync |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/app/cron/page.tsx` | 페이지 |
| `src/app/api/cron/route.ts` | GitHub API 프록시 |
| `src/components/cron-section.tsx` | 크론 카드 컴포넌트 |
| `src/hooks/use-cron.ts` | SWR 데이터 훅 (1분 캐시) |
| `bb-samsara/backup/cron-jobs.json` | 크론 데이터 파일 |
