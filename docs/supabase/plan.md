# bb-todo Supabase Migration Plan

## Scope
- Replace local SQLite-backed todo data with Supabase-backed data model and API.
- Keep usage/codex/kimi endpoints separate from todo domain.
- Preserve current app behavior for web, bb-app, and worker/assign flows.

## Current Domain Model

### projects
- id: integer primary key
- name: unique project name
- emoji: optional emoji
- priority: numeric priority
- sort_order: manual ordering
- status: active/inactive-ish currently only `active` is used in reads
- color: optional project color
- discord_channel_id: optional Discord channel mapping
- discord_thread_id: optional Discord thread mapping
- created_at

### categories
- id: integer primary key
- project_id: required
- name: unique within project
- sort_order
- created_at

### items
- id: integer primary key
- project_id: required
- category_id: optional
- status: todo | in_progress | done | review | archived
- title: required
- content: optional text
- sort_order
- updated_at
- created_at
- is_today: boolean-ish
- review_count: integer
- review_emoji: optional text
- owner: optional text (`bbang`, `pang`, `hyungju`, etc.)

### derived views in current app
- active board: statuses in `todo`, `in_progress`, `done`, `review`
- archive: `archived`
- project clear-done: `done` -> `archived`
- review transition increments `review_count`

## Migration Principles
- Keep identifiers stable where possible.
- Migrate SQLite numeric ids into Supabase bigint ids to avoid breaking bb-app/web references.
- Separate `usage` domain from `todo` domain. Do not force usage data into Supabase unless needed later.
- Introduce thin server API compatibility layer first, then switch clients.

## Proposed Rollout
1. Finalize schema in Supabase.
2. Add migration script from SQLite -> Supabase.
3. Add server adapter layer: current REST shape backed by Supabase.
4. Switch web clients without changing hook contracts.
5. Switch bb-app/worker consumers.
6. Freeze SQLite writes and keep snapshot backup.

## API Compatibility Goal
Keep these response shapes stable first:
- `GET /api/projects`
- `PATCH /api/items/:id`
- `POST /api/projects/:id/items`
- `POST /api/projects/:id/clear-done`
- `GET /api/archive`
- `POST /api/assign`

## Open Questions
- Whether `owner` should become enum vs free text.
- Whether Discord mapping belongs on project only or needs per-item override later.
- Whether `review` should remain status or become separate review queue metadata.
