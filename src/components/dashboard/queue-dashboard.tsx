"use client";

import { useMemo } from "react";
import { AlertCircle, Workflow } from "lucide-react";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { ProjectSwimlane } from "@/components/dashboard/project-swimlane";
import { useTodayQueueDashboard } from "@/hooks/use-today-queue-dashboard";

export function QueueDashboard() {
  const { projects, isLoading, isError } = useTodayQueueDashboard();
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

  return (
    <div className="min-h-full overflow-x-hidden bg-muted/20">
      <header className="border-b bg-background/95 px-4 py-4 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl border bg-card">
            <Workflow className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Queue Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Project sequences run independently in parallel.
            </p>
          </div>
        </div>
      </header>

      <main className="w-full max-w-none px-3 py-4 md:px-6 md:py-6">
        {isLoading ? (
          <DashboardSkeleton />
        ) : isError ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center">
            <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">Queue data is unavailable</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The current execution state could not be loaded.
            </p>
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border bg-card p-8 text-sm text-muted-foreground">
            No AI tasks are queued.
          </div>
        ) : (
          <div className="space-y-3">
            {sortedProjects.map((project) => (
              <ProjectSwimlane key={project.project_id} project={project} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
