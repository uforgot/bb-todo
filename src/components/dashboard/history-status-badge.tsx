import {
  AlertCircle,
  CheckCircle2,
  CircleMinus,
  CircleStop,
  Clock3,
  Eye,
  LoaderCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  TodayQueueRunStatus,
  TodayQueueTaskRunStatus,
} from "@/lib/today-queue-types";

const statusConfig = {
  running: {
    label: "Running",
    icon: LoaderCircle,
    className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  pending: {
    label: "Pending",
    icon: Clock3,
    className: "border-border bg-muted/60 text-muted-foreground",
  },
  active: {
    label: "Active",
    icon: LoaderCircle,
    className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  review: {
    label: "Review",
    icon: Eye,
    className: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  stopped: {
    label: "Stopped",
    icon: CircleStop,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  skipped: {
    label: "Skipped",
    icon: CircleMinus,
    className: "border-border bg-muted/60 text-muted-foreground",
  },
} satisfies Record<
  TodayQueueRunStatus | TodayQueueTaskRunStatus,
  { label: string; icon: typeof AlertCircle; className: string }
>;

interface HistoryStatusBadgeProps {
  status: TodayQueueRunStatus | TodayQueueTaskRunStatus;
  className?: string;
}

export function HistoryStatusBadge({
  status,
  className,
}: HistoryStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium",
        config.className,
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {config.label}
    </span>
  );
}
