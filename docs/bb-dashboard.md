# Today Queue Dashboard plan

Date: 2026-07-27
Status: historical handoff plan; implementation completed through Phase 3
Repository: `/Users/bbangbbang/repos/bb-todo`

> This document records the original implementation plan. The authoritative current behavior and graph decision are in `docs/project-scoped-today-queue.md`; live QA procedures are in `docs/project-scoped-today-queue-qa.md`.

## 1. Goal

Add a read-only web dashboard that makes the existing Today AI Queue execution model visible.

The dashboard must help the user understand:

- which project sequences are running in parallel;
- the ordered tasks inside each project;
- the active, pending, review, completed, stopped, and failed states;
- what happened in previous sequence runs;
- where to open the related issue and Discord execution messages.

A task list shows order but hides relationships and parallel execution. The dashboard is a discovery tool: visualizing real sequence runs should reveal which graph concepts are actually needed before designing a general workflow graph.

## 2. Product decision

Build a **read-only execution diagram first**. Do not build a graph editor yet.

Current topology is simple:

```text
Project A: A1 -> A2 -> A3
Project B: B1 -> B2
Project C: C1
```

- Tasks inside one project run sequentially.
- Different projects can run in parallel.
- There are no branches, joins, conditional edges, or cross-project dependencies today.

For the first version, render project swimlanes with normal React DOM and CSS connectors. Do not add React Flow merely to draw linear sequences. Reconsider a graph library only after real use exposes branching or authoring requirements.

## 3. Current system, verified from code

### Backend

The local backend is `server/usage-server.js`, backed by SQLite at `server/cron.db` unless `CRON_DB_PATH` overrides it.

Queue domain logic is split into:

- `server/today-queue-service.js`
- `server/today-queue-result-handler.js`
- `server/today-queue-bridge.js`
- `server/today-queue-policy.js`
- `server/today-queue-prompt.js`

Existing endpoints:

- `GET /api/today-queue/status`
- `GET /api/today-queue/status?project_id=:id`
- `POST /api/today-queue/start`
- `POST /api/today-queue/next`
- `POST /api/today-queue/stop`
- `PUT /api/projects/:id/today-queue/order`
- `POST /api/projects/:id/today-queue/items`

The authoritative behavior contract is `docs/project-scoped-today-queue.md`.

### Execution rules that must not change

- One active task maximum per project.
- Different projects may execute concurrently.
- Queue order is `items.today_queue_order` within each project.
- Only `todo` tasks are dispatched.
- An accepted `DUDU_RESULT_V1` marker moves `in_progress -> review`.
- `done` remains the user's approval state.
- Stop affects only one project and invalidates the old nonce.
- Active and review nodes stay fixed while agents may reorder pending nodes.
- Duplicate or stale result markers must never advance the sequence.

### Existing item execution metadata

`items` currently stores only the latest dispatch state:

- `today_queue_order`
- `dispatch_nonce`
- `dispatch_message_id`
- `dispatch_channel_id`
- `dispatch_message_url`
- `dispatch_target_bot_key`
- `dispatch_target_bot_user_id`
- `dispatch_started_at`
- `dispatch_attempt_count`
- `dispatch_last_error`

This is enough for current status but **not enough for run history**. New dispatches overwrite several fields, and accepted completion-message metadata is broadcast but not persisted.

### Web app

The Next.js web app currently has no Queue dashboard.

- Home is `src/app/page.tsx`.
- Project data comes from `src/hooks/use-projects.ts`.
- Home renders Today tasks as a flat grouped list and project accordions.
- `/api/projects` proxies the authenticated local API through a Next route.
- Existing UI stack: Next.js 16, React 19, Tailwind CSS 4, Radix/shadcn-style primitives, SWR, Lucide.
- `motion/react` and React Flow are not installed.

## 4. Scope

### MVP

1. Add a `/dashboard` route.
2. Show a live, read-only swimlane for each project containing AI Today tasks.
3. Show task status, order, active duration, bot, and last error.
4. Open a task detail panel without leaving the diagram.
5. Link to the related issue, Discord dispatch message, and Discord result message when available.
6. Persist sequence-run and task-run history.
7. Show previous runs and their task attempts.
8. Work on mobile and desktop.

### Explicit non-goals

- Visual graph authoring.
- Branches, joins, conditions, loops, or cross-project edges.
- Replacing the existing queue order controls.
- Running an arbitrary task directly from the diagram.
- Changing `review`/`done` ownership.
- Replacing the current Home task list.
- Introducing a generic workflow engine.

## 5. Information architecture

Route: `/dashboard`

Recommended page structure:

1. **Header**
   - Title: `Queue Dashboard`
   - Live/last-updated indicator
   - Manual refresh button
2. **Current execution**
   - One swimlane per project
   - Running projects first, then projects with pending/review work
3. **Run history**
   - Recent runs across all projects
   - Project and status filters
4. **Task/run detail sheet**
   - Opens from a task node or history row
   - Keeps dashboard context visible

Add the dashboard to the existing navigation only after the route works. Preserve the current Home page as the operational task list.

## 6. Diagram behavior

### Desktop

- One horizontal lane per project.
- Project identity and run state at the left.
- Task nodes flow left to right by captured sequence order.
- Horizontal overflow is allowed inside a lane; the page itself should not overflow.
- Separate lanes communicate parallelism. Do not connect different projects.

### Mobile

- Keep one project card per lane.
- Render tasks vertically from top to bottom.
- Avoid a tiny zoomed-out canvas.
- Task details open in a bottom sheet or full-width dialog.

### Node states

Use text/icon/shape in addition to color.

- `pending`: neutral outline, order number visible.
- `active`: emphasized border and `Running` label; show elapsed time.
- `review`: eye icon and `Review` label.
- `completed`: check icon. This refers to a completed historical task run, not necessarily current item status `done`.
- `failed`: error icon, concise error preview, retry attempt count.
- `stopped`: stop icon and muted style.
- `skipped`: reserve the state for future history compatibility; current queue does not skip automatically.

Do not animate the graph in MVP. A static diagram refreshed from server state is easier to trust. If animation is added later, use only opacity/transform, stay under 200ms, and respect reduced motion.

### Node content

Keep each node compact:

- sequence number;
- task title, at most two lines;
- status label;
- bot name/avatar token;
- duration or waiting state;
- attempt count only when greater than one;
- error indicator when present.

### Detail panel

Show:

- task title and full content;
- project/category;
- captured sequence position;
- current item status and historical run status separately;
- bot identity;
- queued, started, completed/stopped timestamps;
- duration;
- attempt number;
- concise error;
- declared git commit if present;
- external links.

External link buttons:

- `Open issue`
- `Open Discord task`
- `Open Discord result`

Use actual links with `target="_blank"` and `rel="noreferrer"`. Icon-only variants require `aria-label`.

## 7. Persistence design

Do not try to reconstruct run history from the mutable `items` row. Add append-only history tables.

### `today_queue_runs`

One row represents one project sequence execution, beginning with an explicit Start or automatic continuation of that same run.

Suggested columns:

```sql
CREATE TABLE today_queue_runs (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL CHECK (
    status IN ('running', 'completed', 'stopped', 'failed')
  ),
  started_by TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  stopped_at TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_today_queue_runs_project_started
  ON today_queue_runs(project_id, started_at DESC);
```

### `today_queue_task_runs`

One row represents one dispatch attempt. Retries create additional rows rather than overwriting the first attempt.

```sql
CREATE TABLE today_queue_task_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES today_queue_runs(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  sequence_index INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'active', 'review', 'completed', 'failed', 'stopped', 'skipped')
  ),
  item_title TEXT NOT NULL,
  item_content TEXT,
  issue_url TEXT,
  bot_key TEXT,
  bot_user_id TEXT,
  dispatch_nonce TEXT,
  dispatch_channel_id TEXT,
  dispatch_message_id TEXT,
  dispatch_message_url TEXT,
  result_message_id TEXT,
  result_message_url TEXT,
  git_commit TEXT,
  queued_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  stopped_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id, item_id, attempt)
);

CREATE INDEX idx_today_queue_task_runs_run_sequence
  ON today_queue_task_runs(run_id, sequence_index, attempt);
CREATE INDEX idx_today_queue_task_runs_item
  ON today_queue_task_runs(item_id, started_at DESC);
```

### Item issue link

Add a nullable explicit field to `items`:

```sql
ALTER TABLE items ADD COLUMN issue_url TEXT;
```

Do not make the dashboard parse arbitrary URLs from `content`. Content parsing is acceptable only as a temporary fallback. The edit/create APIs and native app models will eventually need to carry `issue_url`.

If future integrations need GitHub metadata, add provider/repository/number fields later. A generic URL is enough for MVP.

### Run lifecycle

1. `POST /api/today-queue/start` creates a `running` project run before the first successful dispatch.
2. Capture the eligible queue order for that run as task-run snapshots with `pending` status.
3. Dispatching a task marks its attempt `active` and stores Discord dispatch metadata.
4. An accepted result marker stores result-message URL and git commit, then marks the attempt `review`.
5. Automatic `next` receives the existing `run_id`; it must not create a new run.
6. When no `todo` remains after an accepted result, mark the run `completed`.
7. Stop marks the active attempt and run `stopped`.
8. A dispatch failure marks the attempt `failed`. Keep the run `running` if the same task can be retried; only mark the run `failed` when execution is explicitly abandoned.
9. Reordering pending items during a run updates current queue order but does not rewrite historical completed attempts. Decide whether undispatched snapshots follow the new order; recommendation: update their `sequence_index` so history matches what actually ran.

### Important distinction

Current item status and historical task-run status are different domains.

Example: an item can be `done` today while its historical task run ended at `review`. The run history must keep the event as it happened and must not be rewritten when the user later approves the item.

### Legacy data

Do not invent sequence boundaries for old item metadata.

Recommended behavior:

- Run history starts from the migration deployment time.
- Existing `dispatch_message_url` remains visible in current task details.
- If old data must be imported later, label each recovered event `Legacy execution` and do not group unrelated items into a guessed run.

## 8. API contract

### Extend current status

Keep `GET /api/today-queue/status` backward compatible. Add optional fields:

```json
{
  "projects": [
    {
      "project_id": 43,
      "current_run_id": "run_uuid_or_null",
      "running": true,
      "items": [
        {
          "id": 1103,
          "today_queue_order": 10,
          "issue_url": "https://github.com/.../issues/123",
          "current_task_run_id": "task_run_uuid_or_null"
        }
      ]
    }
  ]
}
```

Do not remove existing top-level aggregate fields or project fields.

### Run list

```http
GET /api/today-queue/runs?project_id=43&status=completed&cursor=...&limit=20
```

Response:

```json
{
  "runs": [],
  "next_cursor": null
}
```

Each list row should include project identity, status, start/end time, duration, task counts, failed count, and current/last task title. Do not return every task transcript in the list endpoint.

### Run detail

```http
GET /api/today-queue/runs/:run_id
```

Return the run and ordered task attempts, including external links and errors.

### Task history

Optional if the run detail covers MVP:

```http
GET /api/items/:item_id/today-queue-runs?cursor=...&limit=20
```

Add only when the task detail UI needs cross-run history.

### Next.js proxy routes

Mirror authenticated backend endpoints under:

- `src/app/api/today-queue/status/route.ts`
- `src/app/api/today-queue/runs/route.ts`
- `src/app/api/today-queue/runs/[id]/route.ts`

Reuse one shared proxy helper instead of copying `USAGE_API_URL` and authorization logic into every route.

## 9. Frontend structure

Suggested files:

```text
src/app/dashboard/page.tsx
src/app/api/today-queue/status/route.ts
src/app/api/today-queue/runs/route.ts
src/app/api/today-queue/runs/[id]/route.ts
src/hooks/use-today-queue-dashboard.ts
src/components/dashboard/queue-dashboard.tsx
src/components/dashboard/project-swimlane.tsx
src/components/dashboard/task-run-node.tsx
src/components/dashboard/run-history.tsx
src/components/dashboard/task-run-detail.tsx
src/components/dashboard/dashboard-skeleton.tsx
src/lib/today-queue-types.ts
src/lib/usage-api-proxy.ts
```

Use existing project primitives first. Add an accessible Radix dialog/sheet primitive if the project does not already have one; do not hand-roll focus trapping.

### Data refresh

MVP recommendation:

- SWR for current status with a 3-second refresh interval while the page is visible.
- Revalidate on focus and reconnect.
- Manual refresh button.
- Run history revalidates after current status changes from running to terminal.

The backend already broadcasts SSE, but the web app does not currently consume it. Do not block MVP on a Vercel-to-local SSE proxy. Add SSE later only if polling proves inadequate.

### Loading, empty, and error states

- Use structural skeleton lanes, not a centered spinner.
- Current empty state: `No AI tasks are queued.` with one link back to Home.
- History empty state: `No sequence runs have been recorded yet.`
- Show refresh errors beside the last-updated indicator while preserving stale data.
- Show task/run API errors inside the detail surface that requested them.

## 10. Implementation phases

### Phase 1 — current-state diagram

Deliverables:

- Next proxy for existing queue status.
- Shared TypeScript types matching the backend contract.
- `/dashboard` route.
- Responsive project swimlanes and task nodes.
- Detail panel using existing item metadata.
- Discord dispatch link and issue link when present.
- Polling, skeleton, empty, and stale-error states.

Verification:

- A and B running concurrently appear as separate active lanes.
- Order matches `today_queue_order` exactly.
- Review nodes are never shown as active.
- Mobile uses vertical nodes without horizontal page overflow.
- Existing Home behavior is unchanged.

### Phase 2 — persisted run history

Deliverables:

- SQLite migrations for run/task-run tables and `items.issue_url`.
- Run lifecycle integration in start, dispatch, result, next, stop, retry, and recovery paths.
- Run list/detail backend endpoints.
- History list and detail UI.
- Persist both Discord dispatch and result links.

Verification:

- Start -> two accepted tasks -> empty creates one completed run with two ordered task records.
- A and B create separate run IDs and never mix tasks.
- Retry creates another attempt without overwriting the previous error.
- Stop closes only the selected project run.
- Duplicate/stale markers create no history mutation.
- Restart recovery continues the same run when identity is recoverable.

### Phase 3 — graph discovery review

Dogfood the dashboard before adding graph editing. Record observed needs such as:

- a task blocked by multiple predecessors;
- optional branches;
- retry policies;
- manual approval gates;
- cross-project dependencies;
- grouping or reusable subflows.

Only after concrete examples exist, write a separate graph-authoring contract. Do not infer a DAG schema from visual preference alone.

## 11. Testing plan

### Backend automated tests

Extend the existing Node test suite:

- run creation is atomic with first dispatch;
- project-scoped continuation preserves run ID;
- run completion on empty queue;
- stop and failure lifecycle;
- retry attempt append-only behavior;
- result URL and git commit persistence;
- duplicate/stale result idempotency;
- project isolation;
- restart recovery;
- cursor pagination and filters.

Run:

```bash
node --test server/*.test.js
```

### Frontend checks

- TypeScript/build: `npm run build`
- Lint: `npm run lint`
- Responsive screenshots at mobile and desktop widths.
- Light and dark themes.
- Keyboard navigation through nodes, filters, links, and detail dialog.
- No horizontal page overflow on mobile.
- External links resolve to the expected issue and Discord messages.

### Live smoke test

Use disposable projects/items and a QA Discord thread, following `docs/project-scoped-today-queue-qa.md`.

Verify:

1. Two projects run concurrently.
2. Their lanes update independently.
3. Completion advances only the matching lane.
4. Stop/failure states appear without losing prior attempts.
5. History remains after server and browser restart.
6. Disposable data is removed afterward.

## 12. Risks and guardrails

### History correctness

Risk: writing history after Discord dispatch can leave a sent message without a task-run record.

Guardrail: create the run/attempt before sending, then update it with returned Discord metadata. Treat send failure as a persisted failed attempt.

### Run identity during restart

Risk: current `items` rows have no explicit run ID.

Guardrail: add `current_run_id` or equivalent persisted linkage before enabling history. Recovery must reuse it, not guess by timestamp.

### Mutable task data

Risk: later title/content edits make old history misleading.

Guardrail: snapshot title, content, sequence index, issue URL, and bot identity into task-run rows.

### Graph scope creep

Risk: a dashboard becomes a workflow editor before the execution model is understood.

Guardrail: keep MVP read-only and linear. Require observed branching cases before changing the domain model.

### Secret exposure

Risk: the browser receives the local API credential.

Guardrail: all local API calls stay behind Next server routes. Never expose `USAGE_API_KEY` to client code.

## 13. First implementation task for the next session

Start with **Phase 1 only**.

1. Read this document and `docs/project-scoped-today-queue.md`.
2. Inspect the latest `server/today-queue-service.js` and `src/app/page.tsx`; do not assume this document is newer than code.
3. Add the shared authenticated proxy helper and queue-status route.
4. Add TypeScript types from the actual response.
5. Build `/dashboard` with responsive read-only swimlanes.
6. Use current fields only; do not add speculative run tables during Phase 1.
7. Verify with build, lint, mobile/desktop screenshots, and live queue data.
8. Leave implementation work in review; do not mark it done without user approval.

## 14. Completion criteria for the whole dashboard project

The project is complete when:

- current project sequences and parallel execution are understandable at a glance;
- displayed order and state match the queue backend;
- each historical run is reconstructable without reading mutable item rows;
- retries and failures remain visible rather than being overwritten;
- issue, Discord task, and Discord result links open the correct records;
- mobile and desktop layouts remain usable;
- existing queue execution semantics and Home behavior are unchanged;
- real dashboard use provides enough evidence to decide whether a graph editor is needed.
