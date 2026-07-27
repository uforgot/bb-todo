"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Workflow } from "lucide-react";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { ProjectSwimlane } from "@/components/dashboard/project-swimlane";
import { RunHistory } from "@/components/dashboard/run-history";
import { TaskRunDetail } from "@/components/dashboard/task-run-detail";
import { useTodayQueueDashboard } from "@/hooks/use-today-queue-dashboard";
import type { TodayQueueItem } from "@/lib/today-queue-types";

function formatLastUpdated(value: Date | null) {
  if (!value) return "Connecting";
  return `Updated ${value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

export function QueueDashboard() {
  const {
    projects,
    lastUpdatedAt,
    isLoading,
    isRefreshing,
    isError,
    error,
    refresh,
  } = useTodayQueueDashboard();
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sortedProjects = useMemo(
    () =>
      projects
        .map((project, index) => ({ project, index }))
        .sort((a, b) => {
          if (a.project.running !== b.project.running) {
            return a.project.running ? -1 : 1;
          }
          return a.index - b.index;
        })
        .map(({ project }) => project),
    [projects]
  );
  const selectedItem = useMemo(
    () =>
      sortedProjects
        .flatMap((project) => project.items)
        .find((item) => item.id === selectedItemId) ?? null,
    [selectedItemId, sortedProjects]
  );
  const hasStaleData = isError && sortedProjects.length > 0;

  function selectTask(item: TodayQueueItem, trigger: HTMLButtonElement) {
    detailTriggerRef.current = trigger;
    setSelectedItemId(item.id);
  }

  return (
    <div className="min-h-full overflow-x-hidden bg-muted/20">
      <header className="border-b bg-background px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl border bg-card">
              <Workflow className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-balance text-lg font-semibold">
                Queue Dashboard
              </h1>
              <p className="text-pretty text-sm text-muted-foreground">
                Project sequences run independently in parallel.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className="text-xs text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {formatLastUpdated(lastUpdatedAt)}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {isRefreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-none px-3 py-4 md:px-6 md:py-6">
        <section aria-labelledby="current-execution-heading">
          <div className="mb-4">
            <h2 id="current-execution-heading" className="text-base font-semibold">
              Current execution
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Live item states from each project queue.
            </p>
          </div>

          {hasStaleData && (
            <div
              className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-background p-3"
              role="status"
            >
              <p className="flex items-center gap-2 text-sm">
                <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
                Showing the last known state. {error?.message}
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="min-h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
            </div>
          )}

          {isLoading ? (
            <DashboardSkeleton />
          ) : isError && sortedProjects.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center">
              <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
              <h2 className="mt-3 text-balance font-semibold">
                Queue data is unavailable
              </h2>
              <p className="mt-1 text-pretty text-sm text-muted-foreground">
                {error?.message || "The current execution state could not be loaded."}
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-4 min-h-10 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
            </div>
          ) : sortedProjects.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">No AI tasks are queued.</p>
              <Link
                href="/"
                className="mt-4 inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open Todo
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedProjects.map((project) => (
                <ProjectSwimlane
                  key={project.project_id}
                  project={project}
                  onSelectTask={selectTask}
                />
              ))}
            </div>
          )}
        </section>

        <RunHistory currentProjects={sortedProjects} />
      </main>

      <TaskRunDetail
        item={selectedItem}
        returnFocusRef={detailTriggerRef}
        onClose={() => setSelectedItemId(null)}
      />
    </div>
  );
}
