"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Minus } from "lucide-react";
import type { TodoItem as TodoItemType } from "@/lib/parser";

interface TodoItemProps {
  item: TodoItemType;
  onToggle?: (lineIndex: number, checked: boolean) => void;
}

export function TodoItem({ item, onToggle }: TodoItemProps) {
  const [open, setOpen] = useState(false);
  const hasDesc = item.descriptions.length > 0;

  return (
    <div>
      <div className="flex items-start gap-2.5 py-1">
        <label className="flex items-start gap-2.5 flex-1 cursor-pointer min-w-0">
          <Checkbox
            checked={item.checked}
            onCheckedChange={(checked) => onToggle?.(item.line, !!checked)}
            className="mt-0.5 shrink-0"
          />
          <span
            className={`text-sm leading-snug text-pretty ${
              item.checked ? "line-through text-muted-foreground" : ""
            }`}
          >
            {item.text}
          </span>
        </label>
        {hasDesc && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 size-4 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            aria-label="설명 보기"
          >
            {open ? (
              <Minus className="size-3" />
            ) : (
              <Plus className="size-3" />
            )}
          </button>
        )}
      </div>
      {hasDesc && open && (
        <ul className="ml-7 mb-0.5 space-y-0">
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
