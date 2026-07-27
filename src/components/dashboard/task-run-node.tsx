import {
  AlertCircle,
  Bot,
  Circle,
  Eye,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodayQueueItem } from "@/lib/today-queue-types";

interface TaskRunNodeProps {
  item: TodayQueueItem;
  fallbackOrder: number;
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
  error: {
    label: "Needs attention",
    icon: AlertCircle,
    className: "border-destructive/40 bg-destructive/[0.045]",
    iconClassName: "text-destructive",
  },
} as const;

function getNodeState(item: TodayQueueItem): keyof typeof stateStyles {
  if (item.status === "in_progress") return "active";
  if (item.status === "review") return "review";
  if (item.dispatch_last_error) return "error";
  return "pending";
}

export function TaskRunNode({ item, fallbackOrder }: TaskRunNodeProps) {
  const state = stateStyles[getNodeState(item)];
  const StateIcon = state.icon;
  const order = item.today_queue_order ?? fallbackOrder;
  const bot = item.dispatch_target_bot_key || item.default_ai_bot_key;

  return (
    <article
      data-item-id={item.id}
      data-queue-order={order}
      data-status={item.status}
      className={cn(
        "w-full rounded-xl border p-3 md:w-64 md:min-h-36",
        state.className
      )}
      aria-label={`${order}. ${item.title}, ${state.label}`}
    >
      <div className="flex items-center justify-between gap-3">
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
      </div>

      <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-5">
        {item.title}
      </h3>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1">
          <Bot className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{bot}</span>
        </span>
        {item.dispatch_attempt_count > 1 && (
          <span className="inline-flex items-center gap-1">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Attempt {item.dispatch_attempt_count}
          </span>
        )}
      </div>

      {item.dispatch_last_error && (
        <p className="mt-2 line-clamp-1 text-xs text-destructive">
          {item.dispatch_last_error}
        </p>
      )}
    </article>
  );
}
