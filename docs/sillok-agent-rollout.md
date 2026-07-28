# Sillok Agent Summary Rollout

## Production mode

`MEETING_AGENT_SUMMARY_ENABLED=true` is the cutover switch.

When enabled:

1. completed transcription creates a durable `meeting_summary_jobs` row;
2. the Discord dispatcher sends only the bounded locator to channel `1475129999991509094`;
3. the local Agent runner claims `awaiting_agent` work and invokes an isolated `openclaw agent` session;
4. the memory-aware handler selects bounded USER/MEMORY/daily context and writes through the nonce-validated result API;
5. the reconciler owns retry, stale lease recovery, and dead-letter transitions.

The legacy `queueMeetingSummary()` OpenRouter path is not called automatically in Agent mode. `POST /api/meetings/:id/summary/retry` remains an explicit operator-only degraded path and must not be used by dispatcher, runner, or reconciler.

## Operational checks

```bash
node server/sillok-summary-ops.js pending
node server/sillok-summary-ops.js list
node server/sillok-summary-ops.js reconcile
node server/sillok-summary-ops.js retry <job-id>
```

Expected healthy state:

- new jobs move `queued → dispatching → awaiting_agent → processing → completed`;
- completed rows have `context_mode=openclaw_memory`, `result_agent=bbangbbang`, and the actual OpenClaw model;
- no transcript or memory excerpt appears in Discord or operational logs;
- a prior published summary remains visible while regeneration is pending or failed.

## Rollback

1. Set `MEETING_AGENT_SUMMARY_ENABLED=false` in the usage-server LaunchAgent environment.
2. Restart `com.bbtodo.usage-server`.
3. Existing Agent jobs remain in SQLite for inspection/manual retry; do not delete them.
4. New transcription completions use the legacy path again.

Rollback does not automatically run Opus for pending Agent jobs and does not overwrite existing summaries. To produce a context-free degraded summary, an operator must explicitly call the legacy retry endpoint and record why.

## Failure expectations

- Discord outage: job remains queued with durable error/backoff.
- Listener/OpenClaw outage: acknowledgement or processing lease expires and reconciler schedules a new attempt.
- Duplicate Discord delivery: stable Discord nonce and current attempt nonce prevent duplicate publication.
- Callback response loss: identical writeback replay is accepted.
- Stale nonce: rejected with `409 stale_attempt`.
- Attempt budget exhausted: visible `failed` dead-letter; no silent fallback.

## Disposable E2E result — 2026-07-28

Two in-memory records completed through durable job → claim → real isolated OpenClaw Agent → validated writeback:

- Work: KIA Worldwide interaction scope, collaboration with 윤서우, and EV5 deferral were summarized with `project=KIA` and `model=openai/gpt-5.6-sol`.
- Family: 유리, 민아, 윤아 and the birthday meal were summarized as `conversation_kind=family` without work language, also with `model=openai/gpt-5.6-sol`.

Both jobs reached `completed`. The disposable SQLite database was in-memory and closed after assertions, so no production rows or audio remained.

## Disposable E2E cleanup

Persistent E2E records must use IDs prefixed `sillok-e2e-`. After assertions, delete their `meeting_summary_attempts`, `meeting_summary_jobs`, and `meetings` rows in that order. Disposable audio files, if any, must also be removed. Never run cleanup against a non-prefixed record.
