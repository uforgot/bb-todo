# Archive DB Migration Plan

## Overview

할일빵빵 아카이브를 마크다운 파싱에서 SQLite DB로 전환.
현재 `TODO-archive.md` → SQLite, 프론트에서 검색 가능한 아카이브 뷰 제공.

## Database

- **Engine:** SQLite
- **Location:** `~/.local/bb-todo/archive.db` (git 밖, 맥미니 로컬)
- **Backup:** 불필요 (마크다운 원본 보존)

## Schema

```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  emoji TEXT,
  priority INTEGER NOT NULL DEFAULT 99,  -- 낮을수록 높은 우선순위
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  category_id INTEGER REFERENCES categories(id),  -- NULL 허용 (카테고리 없는 경우)
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'done', 'archived')),
  title TEXT NOT NULL,
  content TEXT,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Structure

```
projects (##)  →  categories (###)  →  items (- [ ] / - [x])
KIA 리뉴얼       CMS 퍼블리싱          main 페이지 CMS 연동
                  HMG CMS 이슈         trailing slash 수정
```

- `projects` — TODO.md의 `##` 섹션 (🚗 KIA 리뉴얼, 📱 dfwork 등)
- `categories` — `###` 하위 그룹 (피드백 리뷰, CMS 이슈 등). nullable.
- `items` — 실제 할일 체크박스 항목

### Status Lifecycle

```
todo → in_progress → done → archived
```

- 아카이브 import: 전부 `status = 'archived'`
- 나중에 TODO DB화 시: `todo` / `in_progress` / `done` 활용
- 정리 크론이 `done` → `archived` 이동 (추후)

## Migration

1. `TODO-archive.md` 파싱 → SQLite import (일회성)
2. 아카이브 항목: `priority = 99`, `status = 'archived'`
3. 마크다운 원본은 삭제하지 않고 보존

## API

### Endpoints (usage-server.js 확장)

```
GET /archive          — 전체 아카이브 항목 (projects + categories + items)
```

- 전체 데이터 한 번에 반환
- 프론트에서 필터링 (API 레벨 검색 불필요)

## Frontend (archive-section.tsx)

### 변경사항

1. **마크다운 파싱 제거** → `/archive` API fetch로 대체
2. **검색 UI** — 상단 텍스트 input, debounce 300ms, `title.includes(keyword)` 프론트 필터링
3. **아코디언 기본 접힘** — 프로젝트별 fold/unfold
4. **역순 정렬** — 최근 아카이브가 위

### UI 구조

```
[🔍 검색...]

▶ 🚗 KIA 리뉴얼 (12)
▶ 📱 dfwork (5)
▶ 🎨 Design Samsung (8)
  ▼ 🎨 Design Samsung
    ▸ windless-gallery (3)
    ▸ BESPOKE AI (2)
    ▸ 기타 (3)
```

## Future (TODO DB화 시)

- 같은 테이블 구조 재사용 (`status = 'todo'` / `in_progress`)
- `priority` 활성 프로젝트에 1, 2, 3 부여
- `item_tags` 다대다 테이블 추가 (라벨 태그 필요 시)
- 백업 크론 추가 (마크다운 원본 없어지는 시점)
