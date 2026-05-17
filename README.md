# bb-todo (할일빵빵)

> AI 에이전트 빵빵과 팡팡이 사용하는 개인 TODO + 모니터링 PWA

[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel)](https://bb-todo-drab.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)

---

## 메뉴

| 메뉴 | 설명 | 문서 |
|------|------|------|
| 📋 **Todo** | TODO.md 체크박스 관리 | [docs/todo.md](docs/todo.md) |
| 🗂 **Archive** | 완료된 항목 아카이브 | [docs/archive.md](docs/archive.md) |
| ⏱ **Cron** | 크론 잡 상태 모니터링 | [docs/cron.md](docs/cron.md) |
| 📊 **Usage** | Claude + Kimi AI 사용량 | [docs/usage.md](docs/usage.md) |
| 🧠 **빵빵** | 빵빵 메모리 변경 이력 | [docs/bbang-pang.md](docs/bbang-pang.md) |
| ✨ **팡팡** | 팡팡 메모리 변경 이력 | [docs/bbang-pang.md](docs/bbang-pang.md) |
| 🎙 **Discord 다리** | voice-bridge / relay-bridge 흐름 | [docs/discord-bridges.md](docs/discord-bridges.md) |

---

## 개요

`bb-samsara` 레포의 `TODO.md`를 실시간으로 읽고, 체크박스를 토글하는 개인용 PWA.
AI 에이전트 모니터링(크론, 사용량, 메모리 이력)까지 통합한 운영 대시보드.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| Data Fetching | SWR |
| UI | shadcn/ui + Tailwind CSS |
| PWA | @ducanh2912/next-pwa |
| Markdown | remark + remark-gfm |
| Icons | lucide-react |
| Deploy | Vercel |

---

## Architecture

```
[Mobile / Browser]
    ↓ SWR (client-side)
[Next.js API Routes on Vercel]
    ├── /api/todo            → GitHub bb-samsara/TODO.md
    ├── /api/archive         → GitHub bb-samsara/TODO-archive.md
    ├── /api/cron            → GitHub bb-samsara/backup/cron-jobs.json
    ├── /api/usage           → 로컬 Usage API (실시간)
    └── /api/memory-history  → GitHub Commits API (diff)

[Usage 실시간 데이터 흐름]
Vercel /api/usage
    ↓ fetch (Bearer token)
Tailscale Funnel (https://ai.tail6603fc.ts.net)
    ↓ proxy
로컬 Usage API 서버 (localhost:3100)
    ├── Claude → macOS plist (Claude Usage Tracker 앱)
    └── Kimi → Moonshot API (/v1/users/me/balance)
```

### 데이터 수집

| 데이터 | 소스 | 방식 |
|--------|------|------|
| Todo / Archive | GitHub API | 정적 파일 |
| Cron | GitHub API | 22:00 백업 |
| **Usage** | **로컬 API 서버** | **실시간** |
| Memory History | GitHub Commits API | 실시간 |

---

## Environment Variables

```env
# GitHub (Todo, Archive, Cron, Memory)
GITHUB_TOKEN=ghp_xxx
GITHUB_OWNER=uforgot
GITHUB_REPO=bb-samsara
GITHUB_FILE_PATH=TODO.md
GITHUB_BRANCH=main

# Usage 실시간 API
USAGE_API_URL=https://ai.tail6603fc.ts.net/usage
USAGE_API_KEY=<Bearer token>
```

---

## Project Structure

```
bb-todo/
├── server/                       # 로컬 Usage API 서버
│   ├── usage-server.js           # Node.js HTTP 서버 (포트 3100)
│   ├── start.sh                  # 환경변수 로드 + 실행
│   └── .env                      # USAGE_API_KEY, USAGE_PORT
├── docs/                         # 메뉴별 문서
│   ├── todo.md
│   ├── archive.md
│   ├── cron.md
│   ├── usage.md
│   └── bbang-pang.md
├── src/
│   ├── app/
│   │   ├── page.tsx              # Todo
│   │   ├── archive/page.tsx      # Archive
│   │   ├── cron/page.tsx         # Cron
│   │   ├── usage/page.tsx        # Usage
│   │   ├── bbang/page.tsx        # 빵빵
│   │   ├── pang/page.tsx         # 팡팡
│   │   └── api/                  # GitHub API 프록시
│   ├── components/
│   │   ├── ui/                   # shadcn/ui
│   │   ├── bottom-tab-bar.tsx
│   │   ├── todo-header.tsx
│   │   ├── todo-section.tsx
│   │   ├── archive-section.tsx
│   │   ├── cron-section.tsx
│   │   ├── usage-section.tsx
│   │   └── memory-history-section.tsx
│   ├── hooks/
│   │   ├── use-todo.ts
│   │   ├── use-archive.ts
│   │   ├── use-cron.ts
│   │   ├── use-usage.ts
│   │   └── use-memory-history.ts
│   └── lib/
│       ├── github.ts             # GitHub API 클라이언트
│       ├── parser.ts             # GFM 파서
│       └── utils.ts
└── package.json
```

---

## Links

- **App:** https://bb-todo-drab.vercel.app
- **Data repo:** https://github.com/uforgot/bb-samsara
- **빵빵 workspace:** https://github.com/uforgot/bb-samsara
- **팡팡 workspace:** https://github.com/uforgot/pp-samsara
