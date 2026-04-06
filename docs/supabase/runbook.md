# bb-todo Supabase Cutover Runbook

## 1. SQLite backup snapshot
```bash
cp server/cron.db server/cron.db.snapshot-$(date +%Y%m%d-%H%M%S)
cp server/cron.db-wal server/cron.db-wal.snapshot-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
cp server/cron.db-shm server/cron.db-shm.snapshot-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
```

## 2. Write freeze
- Stop any process that writes todo data through `server/usage-server.js`.
- Do not run assign / clear-done / item mutation during migration.
- Keep bb-app / web app read-only until migration verification passes.

## 3. Apply schema
- Run `supabase db push` or apply `supabase/migrations/20260405_initial_todo_schema.sql` in Supabase SQL editor.

## 4. Migration dry-run
```bash
node scripts/migrate-sqlite-to-supabase.js --dry-run
```
- Check row counts and sample ids.
- Confirm projects/categories/items counts match SQLite.

## 5. Real migration
```bash
node scripts/migrate-sqlite-to-supabase.js
```

## 6. Verification
- `GET /api/projects`
- `PATCH /api/items/:id`
- `POST /api/projects/:id/items`
- `POST /api/projects/:id/categories`
- `POST /api/projects/:id/clear-done`
- `GET /api/archive`
- bb-app project list + archive screen smoke test

## 7. Rollback
- Restore previous deployment/env without Supabase-backed routes.
- Point web/bb-app back to SQLite-backed API.
- If necessary, discard Supabase imported rows and continue from SQLite snapshot.

## Notes
- Current cutover is partial. assign / assign-self and server-side usage-server todo endpoints still need Supabase parity before full write freeze removal.
