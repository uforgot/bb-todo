# bb-todo TODO API Replacement Path

## Current State
Current todo APIs are embedded inside `server/usage-server.js` together with:
- usage endpoints
- cron polling/status endpoints
- image upload/static serving
- todo CRUD
- assign messaging

This is convenient but too coupled.

## Target Separation

### Keep in usage-server (or separate usage service)
- `/usage`
- `/usage/codex`
- `/usage/kimi`
- cron status endpoints if still SQLite/local-only
- image upload/static if still local disk-based

### Move to Supabase-backed todo API
- `/api/projects`
- `/api/projects/:id`
- `/api/projects/reorder`
- `/api/projects/:id/categories`
- `/api/categories/:id`
- `/api/projects/:id/items`
- `/api/items/:id`
- `/api/items/:id/owner`
- `/api/untoday-all`
- `/api/projects/:id/clear-done`
- `/api/archive`
- `/api/assign`
- `/api/assign-self`
- `/api/discord-channels`
- `/api/discord-channels/sync` (optional if still DB-cached locally)

## Recommended Migration Shape

### Phase 1 — adapter
Keep existing route paths but replace DB calls:
- current handler -> service layer -> Supabase client
- no frontend changes yet

### Phase 2 — domain split
Move todo APIs out of `usage-server.js` into:
- Next.js route handlers, or
- separate todo server

Recommended: Next.js route handlers first, because web app already lives there.

## Service Boundaries

### web
- reads/writes todo data via stable REST endpoints
- subscribes later via Supabase Realtime or fallback polling

### bb-app
- should hit same stable REST endpoints, not direct table access initially
- avoids shipping Supabase service-role secrets to client apps

### worker / assign flow
- server-side only
- reads todo items + project Discord mapping
- posts to Discord
- marks assigned items `in_progress`

## Why not direct client-to-Supabase first?
- business logic exists in transitions (`review_count`, clear-done, assign side effects)
- Discord side effects should remain server-side
- easier parity testing if REST contract stays the same

## Endpoint Mapping Example
- `GET /api/projects` -> `todoService.listActiveProjectsTree()`
- `GET /api/archive` -> `todoService.listArchivedProjectsTree()`
- `PATCH /api/items/:id` -> `todoService.updateItem(id, patch)`
- `POST /api/assign` -> `assignService.assignItems(itemIds)`

## Cutover Rule
Do not switch bb-app/web hooks one by one against different backends. Switch the backend behind the same API first, then clients stay boring.
