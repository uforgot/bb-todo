"use client";

import { useCron, type CronJob } from "@/hooks/use-cron";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function formatNextRun(ms?: number): string {
  if (!ms) return "-";
  const date = new Date(ms);
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms?: number): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function CronJobCard({ job }: { job: CronJob }) {
  const isOk = job.state?.lastStatus === "ok";
  const hasError = (job.state?.consecutiveErrors ?? 0) > 0;

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-border/50 bg-card/30">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{job.name}</span>
          {!job.enabled && (
            <Badge variant="secondary" className="text-xs shrink-0">
              비활성
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {job.schedule.expr ?? job.schedule.kind}
          {job.state?.lastRunAtMs && (
            <span className="ml-2">
              · {formatDuration(job.state.lastDurationMs)}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span className="text-xs text-muted-foreground">
          {formatNextRun(job.state?.nextRunAtMs)}
        </span>
        <span className={`w-1.5 h-1.5 rounded-full ${
          hasError ? "bg-destructive" : isOk ? "bg-green-500" : "bg-muted"
        }`} />
      </div>
    </div>
  );
}

export function CronSection() {
  const { jobs, isLoading, isError } = useCron();

  return (
    <div className="max-w-2xl mx-auto py-2 px-2">

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-xs text-muted-foreground text-center py-4">
          크론잡 정보를 불러올 수 없습니다
        </p>
      )}

      {!isLoading && !isError && (
        <div className="space-y-1.5">
          {jobs.map((job) => (
            <CronJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
