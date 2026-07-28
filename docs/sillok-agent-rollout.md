# Sillok Agent Summary Rollout

## Production mode

`MEETING_AGENT_SUMMARY_ENABLED=true` is the cutover switch.

When enabled:

1. completed transcription creates a durable `meeting_summary_jobs` row;
2. the Discord dispatcher sends a bounded locator plus a safe workflow prompt to channel `1475129999991509094`;
3. the mentioned 빵빵 Discord session runs `sillok-summary-ops.js prepare`, which claims the nonce and fetches transcript plus bounded USER/MEMORY/daily context locally;
4. that same Discord Agent turn follows the shared-memory prompt, writes a protected temporary JSON result, and runs `sillok-summary-ops.js complete` for nonce-validated writeback;
5. the reconciler owns retry, stale lease recovery, and dead-letter transitions.

Transcript and memory never enter the Discord message. The message contains only locator fields and deterministic instructions for retrieving them locally. There is no background/local summary runner; the Discord-mentioned 빵빵 session is the summary Agent.

The legacy `queueMeetingSummary()` OpenRouter path is not called automatically in Agent mode. `POST /api/meetings/:id/summary/retry` remains an explicit operator-only degraded path and must not be used by the dispatcher, Discord Agent workflow, or reconciler.

## Operational checks

```bash
node server/sillok-summary-ops.js pending
node server/sillok-summary-ops.js list
node server/sillok-summary-ops.js reconcile
node server/sillok-summary-ops.js retry <job-id>
```

Expected healthy state:

- new jobs move `queued → dispatching → awaiting_agent`; the Discord turn's `prepare` command moves them to `processing`, and `complete` moves them to `completed`;
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
- Discord Agent/OpenClaw outage: acknowledgement or processing lease expires and reconciler schedules a new attempt.
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
