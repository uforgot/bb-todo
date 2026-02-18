# bb-todo

빵빵(빵빵#6916)이 관리하는 TODO PWA 앱. 형주(uforgot)의 개인 TODO를 모바일에서 보고 체크할 수 있게 만든 앱.

## Stack

- **Framework:** Next.js 15 (App Router)
- **PWA:** `@ducanh2912/next-pwa`
- **UI:** shadcn/ui + Radix UI + Tailwind CSS
- **Data fetching:** SWR
- **Data source:** GitHub API → `uforgot/bb-samsara` repo의 `TODO.md`, `TODO-archive.md`
- **Cron data:** `uforgot/bb-samsara` repo의 `backup/cron-jobs.json` (22:00 크론이 자동 업데이트)
- **Deployment:** Vercel (https://bb-todo-drab.vercel.app)

## Data Flow

```
TODO.md (bb-samsara) ──→ GitHub API ──→ SWR hook ──→ UI
cron-jobs.json (bb-samsara/backup/) ──→ GitHub API ──→ useCron ──→ CronSection
```

체크박스 토글 시: UI (optimistic) → `github.ts` updateTodoMd() → GitHub API → TODO.md 업데이트

## Project Structure

```
src/
├── app/
│   ├── page.tsx          # 메인 (Todo + Archive + Cron 탭)
│   ├── api/cron/route.ts # Cron API route
│   ├── archive/          # 아카이브 페이지
│   └── cron/             # 크론 페이지
├── components/
│   ├── todo-section.tsx      # TODO 아코디언 섹션
│   ├── archive-section.tsx   # 아카이브 섹션
│   ├── cron-section.tsx      # 크론잡 상태 카드
│   ├── bottom-tab-bar.tsx    # 하단 탭 바
│   ├── pull-to-refresh.tsx   # 당겨서 새로고침
│   └── todo-item.tsx         # 체크박스 아이템
├── hooks/
│   ├── use-todo.ts       # TODO.md SWR hook
│   ├── use-archive.ts    # TODO-archive.md SWR hook
│   ├── use-cron.ts       # cron-jobs.json SWR hook (60s 캐시)
│   ├── use-sync-time.ts  # 마지막 동기화 시간
│   ├── use-batch-update.ts   # 배치 업데이트
│   └── use-notifications.ts  # 푸시 알림
└── lib/
    ├── github.ts         # GitHub API (fetchTodo, updateTodoMd, fetchCronJobs, ConflictError)
    ├── parser.ts         # GFM 체크박스 파서
    └── utils.ts          # cn() 유틸
```

## Environment Variables (Vercel)

```
GITHUB_OWNER=uforgot
GITHUB_REPO=bb-samsara
GITHUB_TOKEN=...
GITHUB_BRANCH=main
GITHUB_FILE_PATH=TODO.md
```

## Key Decisions

- **GitHub API 직접 사용** — 별도 백엔드 없음
- **SHA lock** — 충돌 방지 (ConflictError 처리)
- **Optimistic UI** — 체크박스 즉시 반응
- **Cron 데이터** — Gateway REST API 없어서 파일 기반 우회 (jobs.json → bb-samsara → GitHub API)
- **Safe Area** — viewport-fit=cover + safe-area-inset-bottom 처리

## Known Issues / TODO

- [ ] CronSection이 merge conflict로 인해 page.tsx에서 누락됨 — 재추가 필요
- [ ] fetchCronJobs()가 github.ts에서 누락됨 — 재추가 필요
- [ ] 다크 모드
- [ ] 푸시 알림
