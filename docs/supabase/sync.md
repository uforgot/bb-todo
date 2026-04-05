# bb-todo Sync Model for web / bb-app / worker

## Actors
- web app (Next.js)
- bb-app (native app)
- worker / assign flow
- optional future background jobs

## Current Sync Style
- web uses REST + SWR polling/revalidation
- local server exposes SSE `/events`
- bb-app likely consumes REST snapshots rather than true realtime

## Recommended Target

### Canonical write path
All writes go through server API layer.
- keeps transition rules centralized
- keeps Discord/worker side effects server-side
- avoids client divergence

### Read path
Short term:
- web: REST + SWR revalidate
- bb-app: REST refresh on foreground/manual actions

Mid term:
- add Supabase Realtime subscription for lightweight invalidation
- clients receive change event -> refetch affected resource

## Suggested Event Strategy
Avoid syncing full nested project trees over realtime payloads.
Use invalidation events instead:
- `project_changed`
- `item_changed`
- `archive_changed`

Clients then refetch:
- `/api/projects` for active board
- `/api/archive` for archive screen

## Transition Rules to Preserve
- `done` -> `review` increments `review_count`
- `clear-done` archives only `done`
- `assign` sends Discord message and changes status to `in_progress`
- deleting category moves items to root or is handled transactionally

## Conflict Handling
Because the app is basically single-user/small-team, keep it simple:
- last write wins for text fields
- server-side transaction for reorder/move/archive
- optimistic UI only on web where already used

## Recommended Order
1. parity via REST API backed by Supabase
2. add realtime invalidation
3. only then consider direct client queries where useful

## Non-goal
Do not over-design CRDT/offline sync yet. This product does not need conference-grade distributed systems cosplay.
