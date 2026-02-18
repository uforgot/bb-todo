# Todo 메뉴

> 하단 탭바 첫 번째 탭 — 아이콘: `ListTodo`

---

## 개요

`bb-samsara` 레포의 `TODO.md` 파일을 실시간으로 불러와 체크박스를 토글하는 메인 뷰.

---

## 기능

| 기능 | 설명 |
|------|------|
| 섹션 아코디언 | `##` 단위로 접기/펼치기 |
| 체크박스 토글 | 탭 즉시 반영 (Optimistic UI) |
| 자동 저장 | 3초 디바운스 후 GitHub API로 배치 커밋 |
| 충돌 방지 | SHA lock — 충돌 시 최신 내용 fetch 후 retry (최대 3회) |
| Pull-to-refresh | 당겨서 강제 새로고침 |
| 진행률 뱃지 | 헤더에 `완료/전체 (%)` 표시 |

---

## 데이터 흐름

```
TODO.md (bb-samsara)
    → GitHub Contents API
    → /api/todo route (Next.js server)
    → SWR (클라이언트 캐시)
    → remark parser (GFM AST)
    → TodoSection 컴포넌트
```

체크박스 토글 시:
```
UI (optimistic) → use-batch-update (3초 디바운스)
    → github.ts updateTodoMd()
    → GitHub API PUT (SHA lock)
    → 성공: 새 SHA 저장 / 실패(409): retry
```

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/app/page.tsx` | 페이지 |
| `src/app/api/todo/route.ts` | GitHub API 프록시 |
| `src/components/todo-section.tsx` | 섹션 아코디언 |
| `src/components/todo-item.tsx` | 체크박스 아이템 |
| `src/hooks/use-todo.ts` | SWR 데이터 훅 |
| `src/hooks/use-batch-update.ts` | 디바운스 배치 업데이트 |
| `src/lib/github.ts` | GitHub API 클라이언트 |
| `src/lib/parser.ts` | GFM → 구조화 데이터 파서 |
