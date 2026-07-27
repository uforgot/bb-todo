"use client";

import type { RefObject } from "react";
import {
  AlertCircle,
  Bot,
  ExternalLink,
  GitCommitHorizontal,
  RotateCw,
  Timer,
} from "lucide-react";
import { HistoryStatusBadge } from "@/components/dashboard/history-status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTodayQueueRunDetail } from "@/hooks/use-today-queue-history";
import { formatQueueDateTime } from "@/lib/today-queue-time";
import type {
  TodayQueueRunSummary,
  TodayQueueTaskRun,
} from "@/lib/today-queue-types";

interface RunHistoryDetailProps {
  run: TodayQueueRunSummary | null;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function AttemptLinks({ attempt }: { attempt: TodayQueueTaskRun }) {
  const links = [
    ["Discord task", safeExternalUrl(attempt.dispatch_message_url)],
    ["Discord result", safeExternalUrl(attempt.result_message_url)],
    ["Issue", safeExternalUrl(attempt.issue_url)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (!links.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map(([label, href]) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}

function AttemptCard({ attempt }: { attempt: TodayQueueTaskRun }) {
  return (
    <li className="relative pl-8 before:absolute before:bottom-[-1rem] before:left-[0.6875rem] before:top-6 before:w-px before:bg-border last:before:hidden sm:pl-10 sm:before:left-[0.9375rem]">
      <span className="absolute left-0 top-1.5 flex size-6 items-center justify-center rounded-full border bg-background text-[0.625rem] font-semibold tabular-nums sm:size-8 sm:text-xs">
        {attempt.sequence_index}
      </span>
      <article className="rounded-xl border bg-card p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              Sequence {attempt.sequence_index} · Attempt {attempt.attempt}
            </p>
            <h3 className="mt-1 text-pretty text-sm font-semibold">
              {attempt.item_title}
            </h3>
          </div>
          <HistoryStatusBadge status={attempt.status} />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Item</dt>
            <dd className="mt-0.5 font-medium tabular-nums">#{attempt.item_id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Category</dt>
            <dd className="mt-0.5 truncate font-medium">
              {attempt.category_name || "Root"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Bot</dt>
            <dd className="mt-0.5 inline-flex items-center gap-1 font-medium">
              <Bot className="size-3" aria-hidden="true" />
              {attempt.bot_key || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Started</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {formatQueueDateTime(attempt.started_at)}
            </dd>
          </div>
        </dl>

        {attempt.error && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/[0.05] p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-destructive">
              <AlertCircle className="size-3.5" aria-hidden="true" />
              Attempt error
            </p>
            <p className="mt-1 whitespace-pre-wrap text-pretty text-xs leading-5 text-muted-foreground">
              {attempt.error}
            </p>
          </div>
        )}

        {attempt.git_commit && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitCommitHorizontal className="size-3.5" aria-hidden="true" />
            <code className="font-mono text-foreground">{attempt.git_commit}</code>
          </p>
        )}

        {attempt.item_content && (
          <details className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Task snapshot
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-pretty leading-5 text-muted-foreground">
              {attempt.item_content}
            </p>
          </details>
        )}

        <AttemptLinks attempt={attempt} />
      </article>
    </li>
  );
}

export function RunHistoryDetail({
  run,
  returnFocusRef,
  onClose,
}: RunHistoryDetailProps) {
  const { detail, error, isLoading, isRefreshing, refresh } =
    useTodayQueueRunDetail(run?.id ?? null);
  const summary = detail?.run ?? run;

  return (
    <Dialog open={Boolean(run)} onOpenChange={(open) => !open && onClose()}>
      {run && (
        <DialogContent
          className="sm:max-w-3xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <div className="pr-10">
            <DialogTitle>
              {run.project_emoji} {run.project_name}
            </DialogTitle>
            <DialogDescription className="mt-1">
              Historical task attempts captured during this run.
            </DialogDescription>
          </div>

          {summary && (
            <div className="mt-4 rounded-xl border bg-muted/30 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <HistoryStatusBadge status={summary.status} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatQueueDateTime(summary.started_at)}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Tasks</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {summary.task_count}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Attempts</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {summary.attempt_count}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Failed</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {summary.failed_count}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="mt-0.5 inline-flex items-center gap-1 font-semibold tabular-nums">
                    <Timer className="size-3" aria-hidden="true" />
                    {formatDuration(summary.duration_ms)}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {error ? (
            <div
              className="mt-4 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4"
              role="alert"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertCircle className="size-4" aria-hidden="true" />
                Run detail is unavailable
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={isRefreshing}
                className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <RotateCw className="size-3.5" aria-hidden="true" />
                Try again
              </button>
            </div>
          ) : isLoading ? (
            <div className="mt-4 space-y-3" aria-label="Loading run details">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : detail?.task_runs.length ? (
            <ol className="mt-4 space-y-4">
              {detail.task_runs.map((attempt) => (
                <AttemptCard key={attempt.id} attempt={attempt} />
              ))}
            </ol>
          ) : (
            <p className="mt-4 rounded-xl border p-6 text-center text-sm text-muted-foreground">
              No task attempts were recorded for this run.
            </p>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
