"use client";

import type { RefObject } from "react";
import { AlertCircle, Bot, ExternalLink, Timer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useElapsedTime } from "@/hooks/use-elapsed-time";
import { formatQueueDateTime } from "@/lib/today-queue-time";
import type { TodayQueueItem } from "@/lib/today-queue-types";

interface TaskRunDetailProps {
  item: TodayQueueItem | null;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

function getStatusLabel(item: TodayQueueItem) {
  if (item.status === "in_progress") return "Running";
  if (item.status === "review") return "Review";
  if (item.dispatch_last_error) return "Failed";
  return "Pending";
}

export function TaskRunDetail({
  item,
  returnFocusRef,
  onClose,
}: TaskRunDetailProps) {
  const elapsed = useElapsedTime(
    item?.dispatch_started_at ?? null,
    item?.status === "in_progress"
  );

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      {item && (
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <DialogTitle className="pr-10">{item.title}</DialogTitle>
          <DialogDescription className="mt-1">
            Current task execution details
          </DialogDescription>

          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="mt-1 font-medium">{getStatusLabel(item)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Queue order</p>
              <p className="mt-1 font-medium tabular-nums">
                {item.today_queue_order ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Project</p>
              <p className="mt-1 font-medium">
                {item.project_emoji} {item.project_name}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Category</p>
              <p className="mt-1 font-medium">{item.category_name || "Root"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Bot</p>
              <p className="mt-1 inline-flex items-center gap-1.5 font-medium">
                <Bot className="size-3.5" aria-hidden="true" />
                {item.dispatch_target_bot_key || item.default_ai_bot_key}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Attempt</p>
              <p className="mt-1 font-medium tabular-nums">
                {item.dispatch_attempt_count || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Started</p>
              <p className="mt-1 font-medium tabular-nums">
                {formatQueueDateTime(item.dispatch_started_at)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Elapsed</p>
              <p className="mt-1 inline-flex items-center gap-1.5 font-medium tabular-nums">
                <Timer className="size-3.5" aria-hidden="true" />
                {elapsed || "—"}
              </p>
            </div>
          </div>

          {item.dispatch_last_error && (
            <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertCircle className="size-4" aria-hidden="true" />
                Last error
              </p>
              <p className="mt-1 text-pretty text-sm text-muted-foreground">
                {item.dispatch_last_error}
              </p>
            </div>
          )}

          {item.content && (
            <div className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground">Task content</p>
              <p className="mt-2 whitespace-pre-wrap text-pretty text-sm leading-6">
                {item.content}
              </p>
            </div>
          )}

          {item.dispatch_message_url && (
            <div className="mt-5 border-t pt-4">
              <a
                href={item.dispatch_message_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open Discord task
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
