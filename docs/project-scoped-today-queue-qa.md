# Project-scoped Today Queue integration QA

Date: 2026-07-26
Scope: DUDU #1099

## Automated regression

- `node --test server/*.test.js`: 34 passed, 0 failed.
- Scoped ESLint for Queue service, result handler, bridge, policy, and their tests: passed.
- Syntax checks for Queue modules and `usage-server.js`: passed.
- Covered by the regression suite:
  - one active item per project and parallel execution across projects;
  - same-project start locking, stop isolation, and persisted restart recovery;
  - project-correct result continuation;
  - split markers after `item_id`, `nonce`, or `status`;
  - MessageUpdate streaming, duplicate results, wrong nonce/author/channel;
  - missing Discord target and dispatch failure without advancing the item.

## Fresh-server issue found and fixed

An isolated server with a new SQLite database returned HTTP 500 from `GET /api/projects` because the route queried `projects.status`, while fresh schema creation and migrations did not create that column.

`server/usage-server.js` now:

- creates `projects.status TEXT DEFAULT 'active'` for new databases;
- migrates existing databases with `ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active'`.

A second isolated-server run confirmed an empty fresh database returns `200 []` from `GET /api/projects`.

## Live A/B Discord smoke test

The smoke test ran against an isolated `usage-server` and disposable SQLite database. It created two disposable projects and four AI Today items, mapped both projects to the QA Discord thread, and dispatched to the inactive `boongboong` worker identity so no worker session executed the disposable tasks.

Verified:

1. A1 and B1 dispatched concurrently to Discord.
2. Each project reported only its own active item.
3. A duplicate start returned `already_running`.
4. Stopping A reset only A; B remained active.
5. Restarting A dispatched A1 again.
6. After A1 moved to review, A dispatched A2 while B remained unchanged.
7. Missing-target API returned `missing_discord_target` and kept the item in `todo`.
8. Invalid Discord target returned `dispatch_failed` and kept the item in `todo`.
9. Unknown `project_id` returned HTTP 404.
10. SSE captured 40 events with project IDs, including Queue start/stop, item changes, missing target, failure, and cleanup events.

All disposable projects/items were deleted. The isolated database and server were removed after verification.

## bb-app Simulator verification

- iOS Simulator Debug build: succeeded.
- Relaunch against the isolated server loaded both Queue QA projects from a clean app start.
- Light and dark screenshots showed:
  - A running item #2 and B running item #3 independently;
  - separate 44pt stop controls and preserved navigation chevrons;
  - no overlap or contrast issue.
- After B item #3 changed to review, SSE refreshed only the visible Queue state: A remained running #2, while B changed to `Queue 1개 대기` with a Run button.
- Simulator API defaults were removed afterward, production data was reloaded, and the cleanup screenshot confirmed no `Queue QA` projects remained.

Screenshot evidence:

- `/Users/bbangbbang/.openclaw/workspace/tmp/bb-app-1099/queue-live-light.png`
- `/Users/bbangbbang/.openclaw/workspace/tmp/bb-app-1099/queue-live-dark.png`
- `/Users/bbangbbang/.openclaw/workspace/tmp/bb-app-1099/queue-sse-refresh.png`
- `/Users/bbangbbang/.openclaw/workspace/tmp/bb-app-1099/cleanup-production-restored.png`

---

## Phase 2 run-history QA

Date: 2026-07-27
Scope: DUDU #1150

### Automated regression

- `node --test server/*.test.js`: 65 passed, 0 failed.
- `npm run lint`: 0 errors, 21 pre-existing warnings.
- `npm run build`: passed, including TypeScript and the `/dashboard` plus authenticated run-history routes.
- Added a disk-backed lifecycle integration test that closes and reopens SQLite three times while checking:
  - two projects keep distinct run identities;
  - an accepted result advances only its matching project/run;
  - a failed attempt remains immutable when attempt 2 is appended;
  - stopping one project preserves the other running project;
  - completed/stopped run states, retry errors, result metadata, and git commits remain after restart.

### Disposable live run-history smoke test

The smoke test used an isolated `usage-server`, disposable SQLite database, two projects, and four AI Today items. Both projects targeted this QA thread with the inactive `boongboong` worker identity. Production Queue data was not modified.

Verified:

1. A1 and B1 dispatched concurrently with separate run IDs.
2. Accepting A1 preserved A's run ID and left B1 active.
3. A2 against an invalid Discord channel persisted attempt 1 as `failed` with Discord error `10003`.
4. Retrying A2 restored the valid thread, appended attempt 2 as `active`, and preserved attempt 1 and its error.
5. Stopping B produced a historical `stopped` run while A2 remained active.
6. After two isolated-server restarts, A history remained `review → failed → active`, B remained `stopped`, and a project-filtered history query returned only A's run.
7. The final active A run was stopped, the isolated server was terminated, and the disposable database directory was removed.

Evidence:

- `/Users/bbangbbang/.openclaw/workspace/artifacts/bb-todo/dashboard-1150/live-qa-evidence.json`
- `/Users/bbangbbang/.openclaw/workspace/artifacts/bb-todo/dashboard-1150/isolated-server.log`
