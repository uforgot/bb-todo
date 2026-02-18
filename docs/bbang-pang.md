# 빵빵 / 팡팡 메뉴

> 하단 탭바 구분선 오른쪽 — 아이콘: `Brain` (빵빵) / `Sparkles` (팡팡)

---

## 개요

빵빵(Claude Sonnet)과 팡팡(Kimi K2.5)의 메모리 파일 변경 이력을 Git diff 형태로 보여주는 뷰.

두 에이전트의 학습, 결정, 페르소나 변화를 시간순으로 추적할 수 있다.

---

## 기능

| 기능 | 설명 |
|------|------|
| 파일 탭 | `MEMORY.md` / `SOUL.md` / `AGENTS.md` 전환 |
| Git diff 뷰 | 추가(초록) / 삭제(빨강) 라인 하이라이트 |
| 커밋 히스토리 | 날짜, 시간, 커밋 메시지 |
| GitHub 링크 | 각 커밋의 GitHub 페이지로 이동 |

---

## 데이터 소스

| 에이전트 | 레포 | 파일 |
|----------|------|------|
| 빵빵 | `uforgot/bb-samsara` | MEMORY.md, SOUL.md, AGENTS.md |
| 팡팡 | `uforgot/pp-samsara` | MEMORY.md, SOUL.md, AGENTS.md |

---

## 데이터 흐름

```
GitHub Commits API (per file)
    → /api/memory-history?repo=bb-samsara&file=MEMORY.md
    → useMemoryHistory hook (SWR)
    → Git diff 파싱 (patch → add/del 라인 분리)
    → MemoryHistorySection 컴포넌트
```

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/app/bbang/page.tsx` | 빵빵 페이지 |
| `src/app/pang/page.tsx` | 팡팡 페이지 |
| `src/app/api/memory-history/route.ts` | GitHub Commits API 프록시 |
| `src/components/memory-history-section.tsx` | diff 뷰 컴포넌트 |
| `src/hooks/use-memory-history.ts` | SWR 데이터 훅 |
