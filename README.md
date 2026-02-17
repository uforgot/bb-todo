# bb-todo (빵빵투두)

> GitHub TODO.md를 모바일에서 보고 관리하는 PWA

---

## Overview

bb-samsara 레포의 TODO.md를 실시간으로 읽고, 체크박스를 토글하고, 모바일 홈 화면에서 네이티브 앱처럼 사용하는 개인용 PWA.

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 15 (App Router) | Vercel 최적화, 클라이언트 렌더링 |
| Data Fetching | SWR | 클라이언트 캐시 + 포커스 시 자동 revalidate |
| UI | shadcn/ui + Tailwind CSS | Copy-paste 방식, 별도 설치 불필요 |
| PWA | @ducanh2912/next-pwa | App Router 지원, next-pwa 후속 |
| Markdown | remark + remark-gfm | GFM 체크박스 파싱 |
| Icons | lucide-react | shadcn/ui 기본 아이콘 |
| Debounce | use-debounce | 체크박스 배치 업데이트 |
| Deploy | Vercel | GitHub 연동, 자동 배포 |

---

## Features

### Phase 1 — Read-Only MVP

- GitHub API로 TODO.md 가져오기 (SWR 클라이언트 캐시)
- GFM 마크다운 렌더링 (체크박스, 헤더, 리스트)
- 섹션 접기/펼치기 (Accordion)
- PWA manifest + Service Worker (stale-while-revalidate)
- 모바일 최적화 레이아웃
- 로딩 스켈레톤

### Phase 2 — Interactive

- 체크박스 토글 → 디바운스 배치 업데이트 (3초 윈도우)
- GitHub API 업데이트 (SHA lock + retry, 최대 3회 exponential backoff)
- Pull-to-refresh
- 섹션 드래그 앤 드롭 정렬
- Optimistic UI (즉시 반영, 실패 시 롤백)

### Phase 3 — Enhancement

- 다크 모드
- 마감일 푸시 알림
- TODO-archive.md 뷰어

---

## Architecture

```
[Mobile/Browser]
    ↓ SWR (client-side)
[Next.js on Vercel]
    ├── GET  /api/todo  → GitHub Contents API → TODO.md raw
    ├── POST /api/todo  → GitHub Contents API → SHA lock + commit
    └── Static: manifest.json, service-worker.js
    ↓
[GitHub uforgot/bb-samsara]
    └── TODO.md
```

### Data Flow

1. 앱 열기 → SWR 캐시 즉시 표시 → 백그라운드 revalidate
2. 체크박스 토글 → 3초 디바운스 → 변경분 배치 → API route → SHA lock + commit
3. 동시 수정 충돌 → SHA mismatch → 최신 fetch → retry merge → commit

### Concurrency Strategy

- SHA 기반 optimistic locking
- 충돌 시 exponential backoff retry (최대 3회)
- 실패 시 UI 롤백 + 에러 토스트

### Offline Strategy

- Service Worker: stale-while-revalidate
- max-age: 5분 / stale: 1일
- 오프라인에서도 마지막 캐시 표시

---

## Project Structure

```
bb-todo/
├── app/
│   ├── layout.tsx            # Root layout, font, theme provider
│   ├── page.tsx              # Main TODO view
│   ├── api/todo/route.ts     # GET/POST GitHub API proxy
│   └── manifest.ts           # PWA manifest
├── components/
│   ├── ui/                   # shadcn/ui (accordion, checkbox, card, badge, skeleton)
│   ├── todo-section.tsx      # Section card + accordion
│   ├── todo-item.tsx         # Checkbox item
│   └── todo-header.tsx       # Header + completion badge
├── lib/
│   ├── github.ts             # GitHub API client (fetch, update, SHA handling)
│   ├── parser.ts             # TODO.md → structured data (remark AST)
│   └── utils.ts              # cn() utility
├── hooks/
│   ├── use-todo.ts           # SWR hook for TODO data
│   └── use-batch-update.ts   # Debounced batch update hook
├── public/
│   └── icons/                # PWA icons (192x192, 512x512)
├── tailwind.config.ts
├── next.config.mjs           # PWA plugin config
└── package.json
```

---

## Environment Variables

```env
GITHUB_TOKEN=ghp_xxx              # GitHub PAT (repo scope)
GITHUB_OWNER=uforgot
GITHUB_REPO=bb-samsara
GITHUB_FILE_PATH=TODO.md
GITHUB_BRANCH=main
NEXT_PUBLIC_APP_URL=https://bb-todo.vercel.app
```

---

## Implementation Plan

| # | Task | Time |
|---|------|------|
| 1 | Next.js init + shadcn/ui setup | 10min |
| 2 | GitHub API 연동 + SWR 설정 | 20min |
| 3 | TODO.md 파서 (remark AST, 중첩 섹션 처리) | 30min |
| 4 | UI 컴포넌트 (section, item, header) | 30min |
| 5 | PWA 설정 (manifest, service worker) | 20min |
| 6 | 디바운스 + 배치 업데이트 로직 | 15min |
| 7 | SHA lock + retry 메커니즘 | 20min |
| 8 | Vercel 배포 + 환경변수 | 10min |
| 9 | 테스트 + 모바일 최적화 | 25min |
| **Total** | **Phase 1 MVP** | **~3시간** |

---

## Git Repository

- **Name:** bb-todo
- **Owner:** uforgot
- **URL:** https://github.com/uforgot/bb-todo
- **Branch:** main
- **Deploy:** Vercel (GitHub 연동 자동 배포)

---

## Design Notes

- 모바일 퍼스트 (데스크톱은 보너스)
- 최소한의 UI — TODO.md 내용이 주인공
- 빠른 로딩 — SWR 캐시 + Service Worker
- 한 손 조작 최적화

---

## References

- [shadcn/ui](https://ui.shadcn.com)
- [@ducanh2912/next-pwa](https://github.com/nicedoc/next-pwa)
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents)
- [SWR](https://swr.vercel.app)
