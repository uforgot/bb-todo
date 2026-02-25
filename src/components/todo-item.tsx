"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Minus } from "lucide-react";
import type { TodoItem as TodoItemType } from "@/lib/parser";

interface TodoItemProps {
  item: TodoItemType;
  onToggle?: (lineIndex: number, checked: boolean) => void;
  disabled?: boolean;
  dimmed?: boolean;
  sectionLabel?: string;
}

export function TodoItem({ item, onToggle, disabled, dimmed, sectionLabel }: TodoItemProps) {
  const [open, setOpen] = useState(false);
  const hasDesc = item.descriptions.length > 0;

  const showBorder = !item.checked && !sectionLabel;
  const borderClass = showBorder && item.priority === '!1'
    ? "border-l-4 border-l-[#EF4444] pl-2"
    : showBorder && item.priority === '!2'
    ? "border-l-4 border-l-[#F97316] pl-2"
    : "";

  return (
    <div className={`py-1.5 ${borderClass} ${dimmed ? "opacity-70" : ""}`}>
      {sectionLabel && (
        <span className="text-[10px] text-muted-foreground/60 leading-none mb-0.5 block">{sectionLabel}</span>
      )}
      <div className="flex items-center gap-2.5">
        <Checkbox
          checked={item.checked}
          onCheckedChange={(checked) => onToggle?.(item.line, !!checked)}
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
              item.checked ? "line-through text-muted-foreground" : item.today ? "text-[#F97316]" : ""
            }`}
          >
            {item.text}
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
          {item.descriptions.map((desc, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-snug text-pretty">
              {desc}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
