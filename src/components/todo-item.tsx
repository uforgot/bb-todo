"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Minus } from "lucide-react";
import type { ProjectItem } from "@/hooks/use-projects";

interface TodoItemProps {
  item: ProjectItem;
  onToggle?: (id: number, checked: boolean) => void;
  disabled?: boolean;
  dimmed?: boolean;
  sectionLabel?: string;
  isFirstLabel?: boolean;
}

export function TodoItem({ item, onToggle, disabled, dimmed, sectionLabel, isFirstLabel }: TodoItemProps) {
  const [open, setOpen] = useState(false);
  const checked = item.status === "done";
  const hasDesc = !!item.content;

  return (
    <div className={`py-1.5 ${dimmed ? "opacity-70" : ""}`}>
      {sectionLabel && (
        <>
          {!isFirstLabel && <hr className="border-border/30 mt-2 mb-3" />}
          <span className="text-xs font-medium text-muted-foreground/70 leading-none mb-1.5 block">{sectionLabel}</span>
        </>
      )}
      <div className="flex items-center gap-2.5">
        <Checkbox
          checked={checked}
          onCheckedChange={(c) => onToggle?.(item.id, !!c)}
          disabled={disabled}
          className="shrink-0 size-5"
        />
        <button
          type="button"
          onClick={() => hasDesc && setOpen((o) => !o)}
          className={`flex-1 text-left min-w-0 ${hasDesc ? "cursor-pointer" : "cursor-default"}`}
        >
          <span
            className={`text-sm leading-snug text-pretty ${
              checked ? "line-through text-muted-foreground" : item.is_today ? "text-[#38BDF8]" : ""
            }`}
          >
            {item.title}
          </span>
        </button>
        {hasDesc && (
          <span className="shrink-0 size-4 flex items-center justify-center text-muted-foreground">
            {open ? (
              <Minus className="size-3" />
            ) : (
              <Plus className="size-3" />
            )}
          </span>
        )}
      </div>
      {hasDesc && open && (
        <ul className="ml-8 mt-1 space-y-0.5">
          {item.content!.split("\n").map((line, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-snug text-pretty">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
