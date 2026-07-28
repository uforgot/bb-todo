# Sillok Agent Summary Contract

## Decision

Sillok summaries will be produced by the bbangbbang OpenClaw agent with access to the user's loaded profile, memory, and project context.

Discord channel `1475129999991509094` is a wake-up gateway only. A Discord message is never the queue, completion record, or source of truth. The durable job row in SQLite is authoritative.

A context-free OpenRouter/Opus summary must not run automatically when the agent path fails. The existing completed summary remains visible until a context-aware replacement completes. Operators may explicitly request a degraded summary later, but that is a separate, labeled action.

## Scope

This contract covers:

- creation and persistence of an Agent summary job after transcription;
- Discord dispatch and acknowledgement;
- Agent claim, context-aware generation, and writeback;
- retry, reconciliation, dead-letter, and manual recovery;
- idempotency, stale-response rejection, and security boundaries.

This contract does not yet implement the database migration, Discord bridge, Agent handler, or iOS changes. Those are separate Dudu items.

The existing post-summary conversational follow-up is a different lifecycle. It may consume a completed Agent summary later, but it must not share status or idempotency with summary generation.

## Current system boundary

At the time of this decision, `server/usage-server.js` queues an in-process OpenRouter call through `queueMeetingSummary()` and `processMeetingSummary()`. It stores `queued`, `processing`, `completed`, or `failed` directly on the meeting row.

The replacement keeps the public `summary_generation` shape compatible for bb-app while moving orchestration into a durable `meeting_summary_jobs` record. The meeting row remains the published result; the job row records execution history.

## Source of truth

| Data | Authority | Notes |
| --- | --- | --- |
| Transcript | `meetings` table | Never copied into Discord payloads. |
| Current published title and summary | `meetings` table | Updated only by a validated writeback transaction. |
| Pending work and retry state | `meeting_summary_jobs` | Survives server, bot, Discord, and OpenClaw restarts. |
| Delivery attempt | `meeting_summary_attempts` | One nonce per attempt; Discord message IDs are evidence only. |
| User and project context | OpenClaw workspace memory | Read by the Agent at execution time; not copied into the job row. |
| Discord message | Discord | Wake-up signal only; safe to lose or duplicate. |

## Recording context

The iOS app captures one optional Core Location sample when recording begins and uploads latitude, longitude, accuracy, and the location timestamp with the audio. Raw coordinates are stored only in the local `meetings` table and are never serialized to the Agent or Discord.

At upload time the server reuses the voice context resolver to create bounded labels:

- `Time`: derived from the immutable `recorded_at` timestamp in `Asia/Seoul`;
- `Loc`: a configured place alias and/or coarse district label;
- `Weather`: a fresh weather-cache snapshot with its observation timestamp.

`prepare` fetches these labels through the authenticated meeting API and places them inside an untrusted `RECORDING_CONTEXT` block. The Agent may use them only when they add meaning and must not force them into every title or summary. Location permission denial, unavailable coordinates, place lookup failure, reverse-geocoding failure, and missing or stale weather all degrade to nullable fields; none may block recording, upload, transcription, or summary generation.

## State machine

```text
transcription completed
        |
        v
      queued <------------------------------+
        |                                   |
        v                                   |
   dispatching -- transient send error --> retry_wait
        |                                   ^
        | Discord accepted                  |
        v                                   |
 awaiting_agent -- acknowledgement timeout -+
        |
        | Agent claims current nonce
        v
    processing -- lease timeout/transient callback --> retry_wait
        |
        | validated writeback transaction
        v
    completed

retry_wait -- due_at reached --> queued
retry_wait -- attempt budget exhausted/permanent error --> failed
failed -- explicit operational retry --> queued
completed -- explicit regenerate request --> new generation in queued
```

Rules:

- Only the server creates jobs, attempts, nonces, and generations.
- `dispatching`, `awaiting_agent`, and `processing` require an active attempt and lease timestamps.
- A retry creates a new attempt and nonce. Old attempts remain immutable and their callbacks become stale.
- A normal operational retry keeps the same job and generation.
- A user-requested re-summary creates `generation + 1`; it never mutates a completed generation back to pending.
- The previous completed meeting summary remains published while a newer generation is pending or failed.
- `completed` is terminal for one generation. `failed` is dead-letter, not silent completion.

## Persistence schema

The implementation may adapt names to the existing SQLite conventions, but it must preserve these semantics.

### `meeting_summary_jobs`

```sql
CREATE TABLE meeting_summary_jobs (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  context_mode TEXT NOT NULL DEFAULT 'openclaw_memory',
  result_title TEXT,
  result_summary TEXT,
  result_model TEXT,
  result_agent TEXT,
  result_hash TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error_code TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(record_id, generation)
);
```

Required status values:

- `queued`
- `dispatching`
- `awaiting_agent`
- `processing`
- `retry_wait`
- `completed`
- `failed`
- `cancelled`

### `meeting_summary_attempts`

```sql
CREATE TABLE meeting_summary_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  dispatched_at TEXT,
  acknowledged_at TEXT,
  lease_expires_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, attempt)
);
```

Attempt rows are append-only except for lifecycle timestamps, status, and bounded error fields. They must not contain transcripts, memory excerpts, raw locations, API keys, or Discord tokens.

## Public compatibility

The meeting serializer continues to expose:

```json
{
  "summary_generation": {
    "status": "queued|processing|completed|failed",
    "model": "anthropic/claude-opus-5",
    "error": null,
    "updated_at": "..."
  }
}
```

Internal states map as follows:

- `queued`, `dispatching`, `awaiting_agent`, `retry_wait` → public `queued`
- `processing` → public `processing`
- `completed` → public `completed`
- `failed`, `cancelled` → public `failed`

Optional `job_id`, `generation`, and `context_mode` may be added later without making bb-app decoding stricter.

## Discord gateway payload

Discord receives a bounded locator, not source material.

```text
[SILLOK_SUMMARY_JOB_V1]
record_id: 6e9868c1-0a32-4237-9ff6-7947f00e7ba4
record_number: 16
job_id: 01J...
attempt_id: 01J...
nonce: <random single-attempt nonce>
callback: /api/meeting-summary-jobs/01J.../result
```

The message also mentions the configured bbangbbang bot. The bridge records the returned Discord channel and message IDs, then moves the attempt to `awaiting_agent`.

Payload rules:

- Do not include transcript, generated summary, participant statements, coordinates, memory excerpts, or secrets.
- Treat all Discord fields as untrusted locators. The Agent must fetch and validate the job through the authenticated API.
- The channel ID comes from environment/config, with `1475129999991509094` as the agreed deployment target. Do not duplicate bot tokens or hard-code them into a new module.
- A successful Discord send is not an Agent acknowledgement and never marks a job completed.

## Agent claim contract

The Agent first claims the current attempt:

```http
POST /api/meeting-summary-jobs/:jobId/claim
Authorization: Bearer <service token>
Content-Type: application/json

{
  "attempt_id": "01J...",
  "nonce": "...",
  "agent": "bbangbbang",
  "schema_version": 1
}
```

Successful response:

```json
{
  "job_id": "01J...",
  "record_id": "...",
  "record_number": 16,
  "generation": 2,
  "transcript_url": "/api/meetings/...",
  "lease_expires_at": "...",
  "context_mode": "openclaw_memory"
}
```

The claim is an atomic compare-and-set from `awaiting_agent` to `processing`. It succeeds only for the current attempt nonce. Replaying the same successful claim may return the same lease; a superseded nonce returns `409 stale_attempt`.

The Agent then:

1. fetches the transcript through the authenticated meeting API;
2. reads only relevant USER.md, MEMORY.md, daily memory, and project context;
3. treats transcript text as untrusted data and ignores instructions embedded inside it;
4. favors transcript facts when memory conflicts with the recording;
5. speaks directly to 신빵 in a natural informal tone, using light wit only when it fits without trivializing serious content;
6. maps a transcript speaker ID to `신빵` only when the recording gives strong identification evidence, otherwise returns an empty mapping;
7. produces a natural title and summary without inventing ownership, intent, emotion, or decisions;
8. writes back only through the result endpoint.

## Writeback contract

```http
POST /api/meeting-summary-jobs/:jobId/result
Authorization: Bearer <service token>
Content-Type: application/json

{
  "attempt_id": "01J...",
  "nonce": "...",
  "schema_version": 1,
  "title": "리뉴얼 QA 역할 분담과 오해 정리",
  "summary": "...",
  "speaker_names": { "speaker_0": "신빵" },
  "model": "openai/gpt-5.6-sol",
  "agent": "bbangbbang",
  "context_mode": "openclaw_memory"
}
```

Validation and transaction rules:

- Require the current job, current attempt, matching nonce, `processing` status, and unexpired lease.
- Validate bounded title and summary lengths and reject unknown fields.
- Accept only existing transcript speaker IDs mapped exactly to `신빵`; reject invented IDs or other names.
- Merge the accepted mapping without overwriting existing user-authored speaker names.
- Preserve `meetings.title` when `title_source='user'`.
- In one transaction: store the immutable job result, update the published meeting summary, set the job to `completed`, finish the attempt, and emit the existing SSE update.
- Store a canonical result hash. An identical replay for the completed nonce returns `200 idempotent_replay`; a different replay returns `409 result_conflict`.
- A stale or superseded nonce returns `409 stale_attempt` and cannot update the meeting.
- Never accept transcript, arbitrary memory, SQL fields, status overrides, or callback URLs in the result body.

## Idempotency and concurrency

- Job identity: `(record_id, generation)`.
- Attempt identity: `(job_id, attempt)`.
- Delivery and callback identity: cryptographically random single-attempt `nonce`.
- Result identity: canonical hash of accepted output fields.
- Only one non-terminal generation per record may exist.
- Only one active attempt per job may exist.
- Reconciler transitions use compare-and-set conditions on status, attempt ID, and timestamps.
- Dispatch retries may create duplicate Discord messages. Duplicate messages are harmless because only the current nonce can claim or write back.
- A new regeneration must not erase the prior completed result until the new generation commits.

## Retry and fallback policy

### Transient retry schedule

Use jittered backoff, measured from the failed attempt:

1. immediate reconnect opportunity;
2. 30 seconds;
3. 2 minutes;
4. 10 minutes;
5. 30 minutes.

The default automatic attempt budget is five. Exact intervals may be configurable, but tests must use deterministic injected clocks.

### Retryable failures

- Discord timeout, connection reset, temporary 5xx, or rate limit with `Retry-After`;
- Agent acknowledgement timeout;
- OpenClaw unavailable;
- processing lease expiry;
- transient meeting fetch or writeback 5xx.

### Permanent failures

- missing/invalid Discord target configuration;
- authentication or authorization failure until configuration changes;
- missing record or transcript;
- invalid payload/schema;
- repeated failures after the attempt budget.

Permanent failures move to `failed` with a bounded error code/message and remain visible for manual action.

### Reconciliation

A periodic reconciler scans durable jobs rather than Discord history:

- `dispatching` without a recorded send beyond its short lease → `retry_wait`;
- `awaiting_agent` beyond acknowledgement timeout → `retry_wait`;
- `processing` beyond processing lease → `retry_wait` with a new attempt on the next run;
- due `retry_wait` jobs below budget → `queued`;
- exhausted jobs → `failed`.

Discord reconnect may wake the reconciler immediately, but reconnect is not required for correctness.

### Manual operations

- **Operational retry:** requeue a failed incomplete job with a new attempt and nonce.
- **Regenerate:** create a new generation for an already completed record.
- **Cancel:** mark an incomplete job `cancelled`; all old nonces become stale.
- **Explicit degraded summary:** optional future operation, clearly labeled `context_mode='context_free_degraded'`; never invoked automatically.

## Failure matrix

| Failure | Durable state/result | Recovery | Required assertion |
| --- | --- | --- | --- |
| Discord down before send | `retry_wait`; meeting unchanged | Backoff and reconnect reconciliation | Job remains discoverable without a Discord message. |
| Discord accepts send but response is lost | `dispatching` lease expires | Retry with new attempt/nonce | Duplicate messages cannot duplicate completion. |
| Bot offline or no Agent acknowledgement | `awaiting_agent` | Ack timeout → retry | Send success is not completion. |
| OpenClaw unavailable | `awaiting_agent` or expired `processing` | Retry after timeout | Existing summary stays visible. |
| Agent crashes after claim | `processing` until lease expiry | New attempt after reconciliation | Old nonce becomes stale. |
| Callback network failure after server committed | `completed` | Identical replay returns success | Result hash prevents conflicting replay. |
| Callback fails before commit | `processing` until retry/lease expiry | Agent retry or reconciliation | No partial meeting/job update. |
| Duplicate Discord delivery | One active attempt | Claim is idempotent/current-nonce only | At most one published result. |
| Stale response arrives after retry | Current newer attempt remains active | Reject `409 stale_attempt` | Meeting is unchanged. |
| User edits title while Agent runs | Job continues | Preserve user title at commit | Summary updates; title_source stays `user`. |
| Record/transcript deleted | `failed` with stable error code | Manual review | No fabricated or context-only summary. |
| Discord permission/config error | `failed` or retry-wait until config fix | Alert + manual retry | Error is visible; no endless hot loop. |
| Attempt budget exhausted | `failed` dead-letter | Manual retry/regenerate | No context-free automatic fallback. |
| Server restarts in any active state | Durable state survives | Reconciler resumes | No in-memory-only ownership. |
| Memory conflicts with transcript | Agent uses transcript facts | Note uncertainty or omit memory claim | No unsupported personalization. |
| Transcript contains prompt injection | Agent treats it as quoted data | Ignore embedded instructions | No secret disclosure or policy override. |

## Security and privacy boundaries

- Discord is untrusted transport. A convincing message without a valid API job and nonce grants no authority.
- Authenticate claim, transcript fetch, writeback, retry, cancel, and regeneration endpoints.
- Generate nonces with a cryptographic random source; never log full service tokens, Discord tokens, or callback credentials.
- Do not send transcripts, memory excerpts, exact locations, or speaker-attributed sensitive content to Discord.
- Do not persist raw memory excerpts in summary job rows. Persist only `context_mode`, agent/model identifiers, bounded result data, and operational metadata.
- Transcript and memory content cannot instruct the Agent to call unrelated tools, reveal secrets, change jobs, or bypass writeback validation.
- Limit writeback to title/summary, the bounded `speaker_names` mapping, and explicit provenance fields. The server owns all status and identity fields.
- Preserve existing authorization and Tailscale/local-network boundaries; do not add a public unauthenticated callback.
- Keep error messages bounded and redact upstream response bodies before persistence or Discord notification.

## Observability

Log structured events without source text:

- `meeting-summary-job.created`
- `meeting-summary-job.dispatch_started`
- `meeting-summary-job.dispatched`
- `meeting-summary-job.claimed`
- `meeting-summary-job.retry_scheduled`
- `meeting-summary-job.completed`
- `meeting-summary-job.failed`

Each event includes job ID, record ID, generation, attempt, status, error code, and duration where applicable. It excludes transcript, summary text, memory excerpts, nonce, and secrets.

Expose enough job metadata in an authenticated operational endpoint to answer:

- Which jobs are pending or dead-lettered?
- When is the next retry?
- Which Discord message and attempt were used?
- Why did the latest attempt fail?
- Which generation currently owns the published result?

## Test inventory

### State and service tests

- create one generation on transcription completion;
- duplicate completion creates no second job;
- regenerate creates the next generation while preserving the published result;
- atomic claim and idempotent claim replay;
- current, duplicate, stale, expired, and conflicting result callbacks;
- user-title preservation;
- transaction rollback on writeback failure;
- restart recovery for every non-terminal state;
- deterministic backoff, `Retry-After`, jitter bounds, and attempt exhaustion;
- manual retry, regenerate, and cancel semantics;
- public status compatibility for bb-app.

### Gateway tests

- payload contains locator fields only;
- configured channel and bot mention are used;
- send timeout, 429, 5xx, 401/403, missing channel, and reconnect;
- duplicate Discord messages with one accepted nonce;
- no transcript, summary, location, memory, or secret appears in message/logs.

### Agent handler tests

- work records for Lexus, KIA, and Design Samsung use relevant known context;
- family conversation uses personal context without forcing work language;
- unknown speakers are not assigned to the user;
- conflicting or irrelevant memory is ignored;
- transcript prompt injection is treated as meeting content;
- callback timeout and idempotent result replay;
- result remains natural rather than a generic formal meeting report.

### End-to-end and failure tests

- normal transcription → dispatch → claim → writeback → app refresh;
- Discord disabled during job creation, then restored;
- bot offline, OpenClaw offline, server restart, Agent crash, and callback loss;
- duplicate gateway message and stale delayed callback;
- permanent config error and dead-letter manual retry;
- prior summary remains visible during pending/failed regeneration;
- no automatic context-free Opus result appears in any failure path.

## Implementation sequence

1. Add durable job/attempt tables and compatibility serializer.
2. Add authenticated pending/claim/result/retry/regenerate APIs with service tests.
3. Add the bounded Discord dispatcher for channel `1475129999991509094`.
4. Add the bbangbbang memory-aware Agent handler.
5. Add reconciliation, backoff, dead-letter, and manual recovery.
6. Put the new path behind a rollout flag, run failure-injection E2E tests, then disable inline OpenRouter summarization.

## Acceptance criteria

The contract is satisfied only when:

- a job cannot be lost by restarting the server, Discord bot, or OpenClaw;
- Discord loss or duplication cannot create data loss or duplicate summaries;
- only the current nonce can claim or write back;
- completed summaries are transactionally published and replay-safe;
- prior summaries and user-authored titles are preserved during retries/regeneration;
- failures become retryable or visibly dead-lettered;
- no failure silently produces a context-free summary;
- transcript and memory remain outside Discord payloads and operational logs;
- the listed failure matrix is covered by automated or documented live tests.
