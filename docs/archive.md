# Archive 메뉴

> 하단 탭바 두 번째 탭 — 아이콘: `Archive`

---

## 개요

완료된 TODO 항목을 보관하는 `TODO-archive.md` 파일의 뷰어. 읽기 전용.

---

## 기능

| 기능 | 설명 |
|------|------|
| 아카이브 목록 | 완료된 섹션을 완료 날짜와 함께 표시 |
| 섹션 아코디언 | 기본값 닫힌 상태 (`defaultOpen: false`) |
| Pull-to-refresh | 당겨서 새로고침 |
| 진행률 뱃지 | 아카이브 내 체크된 항목 수 표시 |

---

## 아카이브 추가 방법

`scripts/archive-todo.sh` 스크립트로 TODO 섹션을 아카이브로 이동:

```bash
scripts/archive-todo.sh "<섹션 제목>"
```

- 해당 섹션의 모든 항목을 ✅ 체크
- 완료 날짜 추가
- `TODO-archive.md`로 이동
- `TODO.md`에서 해당 섹션 제거

---

## 데이터 흐름

```
TODO-archive.md (bb-samsara)
    → GitHub Contents API
    → /api/archive route
    → SWR (클라이언트 캐시, 5분)
    → remark parser
    → ArchiveSection 컴포넌트
```

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/app/archive/page.tsx` | 페이지 |
| `src/app/api/archive/route.ts` | GitHub API 프록시 |
| `src/components/archive-section.tsx` | 섹션 컴포넌트 |
| `src/hooks/use-archive.ts` | SWR 데이터 훅 |
