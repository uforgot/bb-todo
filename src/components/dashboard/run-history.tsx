"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  History,
  RefreshCw,
  RotateCw,
  Timer,
} from "lucide-react";
import { HistoryStatusBadge } from "@/components/dashboard/history-status-badge";
import { RunHistoryDetail } from "@/components/dashboard/run-history-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { useTodayQueueRunHistory } from "@/hooks/use-today-queue-history";
import { formatQueueDateTime } from "@/lib/today-queue-time";
import type {
  TodayQueueProjectStatus,
  TodayQueueRunStatus,
  TodayQueueRunSummary,
} from "@/lib/today-queue-types";

interface RunHistoryProps {
  currentProjects: TodayQueueProjectStatus[];
}

const runStatuses: Array<{ value: TodayQueueRunStatus; label: string }> = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "stopped", label: "Stopped" },
  { value: "failed", label: "Failed" },
];

function formatDuration(value: number | null) {
  if (value === null) return "—";
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${totalSeconds}s`;
}

function RunCard({
  run,
  onSelect,
}: {
  run: TodayQueueRunSummary;
  onSelect: (run: TodayQueueRunSummary, trigger: HTMLButtonElement) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={(event) => onSelect(run, event.currentTarget)}
        className="group flex min-h-36 w-full flex-col rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              <span aria-hidden="true">{run.project_emoji || "📌"}</span>{" "}
              {run.project_name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {formatQueueDateTime(run.started_at)}
            </p>
          </div>
          <HistoryStatusBadge status={run.status} />
        </div>

        <dl className="mt-4 grid w-full grid-cols-4 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Tasks</dt>
            <dd className="mt-1 font-semibold tabular-nums">{run.task_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Attempts</dt>
            <dd className="mt-1 font-semibold tabular-nums">{run.attempt_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Failed</dt>
            <dd className="mt-1 font-semibold tabular-nums">{run.failed_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="mt-1 inline-flex items-center gap-1 font-semibold tabular-nums">
              <Timer className="size-3" aria-hidden="true" />
              {formatDuration(run.duration_ms)}
            </dd>
          </div>
        </dl>

        <span className="mt-auto inline-flex items-center self-end pt-3 text-xs font-medium text-muted-foreground group-hover:text-foreground">
          View attempts
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </span>
      </button>
    </li>
  );
}

export function RunHistory({ currentProjects }: RunHistoryProps) {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [status, setStatus] = useState<TodayQueueRunStatus | null>(null);
  const [selectedRun, setSelectedRun] = useState<TodayQueueRunSummary | null>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const {
    runs,
    error,
    isLoading,
    isRefreshing,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh,
  } = useTodayQueueRunHistory({ projectId, status });
  const projectOptions = useMemo(() => {
    const projects = new Map<
      number,
      { id: number; name: string; emoji: string | null }
    >();
    currentProjects.forEach((project) => {
      projects.set(project.project_id, {
        id: project.project_id,
        name: project.project_name || `Project ${project.project_id}`,
        emoji: project.project_emoji,
      });
    });
    runs.forEach((run) => {
      projects.set(run.project_id, {
        id: run.project_id,
        name: run.project_name,
        emoji: run.project_emoji,
      });
    });
    return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [currentProjects, runs]);
  const hasStaleData = Boolean(error && runs.length);

  function selectRun(run: TodayQueueRunSummary, trigger: HTMLButtonElement) {
    detailTriggerRef.current = trigger;
    setSelectedRun(run);
  }

  return (
    <section className="mt-8 border-t pt-6" aria-labelledby="run-history-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 id="run-history-heading" className="text-base font-semibold">
              Run history
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
            Execution snapshots stay unchanged after later task approval.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isRefreshing}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh history
        </button>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 sm:p-4 lg:max-w-2xl">
        <label className="text-xs font-medium text-muted-foreground">
          Project
          <select
            value={projectId ?? ""}
            onChange={(event) =>
              setProjectId(event.target.value ? Number(event.target.value) : null)
            }
            className="mt-1.5 min-h-11 w-full rounded-md border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All projects</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.emoji || "📌"} {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Status
          <select
            value={status ?? ""}
            onChange={(event) =>
              setStatus((event.target.value || null) as TodayQueueRunStatus | null)
            }
            className="mt-1.5 min-h-11 w-full rounded-md border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All statuses</option>
            {runStatuses.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hasStaleData && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-background p-3" role="status">
          <p className="flex items-center gap-2 text-sm">
            <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
            Showing cached runs. {error?.message}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="min-h-9 rounded-md border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading run history">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : error && !runs.length ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-card p-6 text-center" role="alert">
          <AlertCircle className="mx-auto size-6 text-destructive" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">Run history is unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCw className="size-3.5" aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : !runs.length ? (
        <p className="mt-4 rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          No runs match these filters.
        </p>
      ) : (
        <>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {runs.map((run) => (
              <RunCard key={run.id} run={run} onSelect={selectRun} />
            ))}
          </ol>
          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <RotateCw className="size-4" aria-hidden="true" />
                {isLoadingMore ? "Loading" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}

      <RunHistoryDetail
        run={selectedRun}
        returnFocusRef={detailTriggerRef}
        onClose={() => setSelectedRun(null)}
      />
    </section>
  );
}
