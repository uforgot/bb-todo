"use client";

import { useState } from "react";
import { useCron, type CronJob } from "@/hooks/use-cron";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";

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

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function cronToKorean(expr?: string): string {
  if (!expr) return "";
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;

  const [min, hour, day, month, dow] = parts;
  const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;

  if (dow !== "*") {
    const days = dow.split(",").map((d) => DAY_NAMES[Number(d)] ?? d).join("·");
    return `매주 ${days} ${time}`;
  }
  if (day === "*" && month === "*") return `매일 ${time}`;
  return expr;
}

function CronJobCard({ job }: { job: CronJob }) {
  const [open, setOpen] = useState(false);
  const isOk = job.state?.lastStatus === "ok";
  const hasError = (job.state?.consecutiveErrors ?? 0) > 0;
  const hasMessage = !!job.payload?.message;

  return (
    <div className={`rounded-lg border bg-card/30 overflow-hidden ${
      hasError ? "border-destructive/60 bg-destructive/5" : "border-border/50"
    }`}>
      {/* 헤더 */}
      <button
        className="w-full flex items-center justify-between py-2 px-3 text-left"
        onClick={() => hasMessage && setOpen((o) => !o)}
        disabled={!hasMessage}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{job.name}</span>
            {!job.enabled && (
              <Badge variant="secondary" className="text-xs shrink-0">비활성</Badge>
            )}
            {hasError && (
              <Badge variant="destructive" className="text-xs shrink-0">
                오류 {(job.state?.consecutiveErrors ?? 0) > 1 ? `×${job.state?.consecutiveErrors}` : ""}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cronToKorean(job.schedule.expr) || job.schedule.kind}
            {job.state?.lastRunAtMs && (
              <span className="ml-2">· {formatDuration(job.state.lastDurationMs)}</span>
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
          {hasMessage && (
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          )}
        </div>
      </button>

      {/* 펼침 내용 */}
      {hasMessage && open && (
        <div className="px-3 pb-3 border-t border-border/30">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono mt-2 leading-relaxed">
            {job.payload!.message}
          </pre>
        </div>
      )}
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
