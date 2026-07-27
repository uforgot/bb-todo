"use client";

import {
  AlertCircle,
  Bot,
  Circle,
  Eye,
  LoaderCircle,
  RotateCcw,
  Timer,
} from "lucide-react";
import { useElapsedTime } from "@/hooks/use-elapsed-time";
import { cn } from "@/lib/utils";
import type { TodayQueueItem } from "@/lib/today-queue-types";

interface TaskRunNodeProps {
  item: TodayQueueItem;
  fallbackOrder: number;
  onSelect: (item: TodayQueueItem, trigger: HTMLButtonElement) => void;
}

const stateStyles = {
  pending: {
    label: "Pending",
    icon: Circle,
    className: "border-border bg-card",
    iconClassName: "text-muted-foreground",
  },
  active: {
    label: "Running",
    icon: LoaderCircle,
    className: "border-foreground/40 bg-foreground/[0.035] shadow-sm",
    iconClassName: "text-foreground",
  },
  review: {
    label: "Review",
    icon: Eye,
    className: "border-sky-500/40 bg-sky-500/[0.06]",
    iconClassName: "text-sky-600 dark:text-sky-400",
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    className: "border-destructive/40 bg-destructive/[0.045]",
    iconClassName: "text-destructive",
  },
} as const;

function getNodeState(item: TodayQueueItem): keyof typeof stateStyles {
  if (item.status === "in_progress") return "active";
  if (item.status === "review") return "review";
  if (item.dispatch_last_error) return "failed";
  return "pending";
}

export function TaskRunNode({
  item,
  fallbackOrder,
  onSelect,
}: TaskRunNodeProps) {
  const stateKey = getNodeState(item);
  const state = stateStyles[stateKey];
  const StateIcon = state.icon;
  const order = item.today_queue_order ?? fallbackOrder;
  const bot = item.dispatch_target_bot_key || item.default_ai_bot_key;
  const elapsed = useElapsedTime(
    item.dispatch_started_at,
    item.status === "in_progress"
  );

  return (
    <button
      type="button"
      data-item-id={item.id}
      data-queue-order={order}
      data-status={item.status}
      data-view-state={stateKey}
      className={cn(
        "w-full rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-36 md:w-64",
        state.className
      )}
      aria-label={`${order}. ${item.title}, ${state.label}. Open details`}
      aria-haspopup="dialog"
      onClick={(event) => onSelect(item, event.currentTarget)}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold tabular-nums">
          {order}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            state.iconClassName
          )}
        >
          <StateIcon className="size-3.5" aria-hidden="true" />
          {state.label}
        </span>
      </span>

      <span className="mt-3 block line-clamp-2 text-sm font-semibold leading-5">
        {item.title}
      </span>

      <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1">
          <Bot className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{bot}</span>
        </span>
        {elapsed && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Timer className="size-3.5" aria-hidden="true" />
            {elapsed}
          </span>
        )}
        {item.dispatch_attempt_count > 1 && (
          <span className="inline-flex items-center gap-1">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Attempt {item.dispatch_attempt_count}
          </span>
        )}
      </span>

      {item.dispatch_last_error && (
        <span className="mt-2 block line-clamp-1 text-xs text-destructive">
          {item.dispatch_last_error}
        </span>
      )}
    </button>
  );
}
