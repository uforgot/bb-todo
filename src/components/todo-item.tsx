"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown } from "lucide-react";
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
      <div className="flex items-start gap-3 py-1.5">
        <label className="flex items-start gap-3 flex-1 cursor-pointer min-w-0">
          <Checkbox
            checked={item.checked}
            onCheckedChange={(checked) => onToggle?.(item.line, !!checked)}
            className="mt-0.5 shrink-0"
          />
          <span
            className={`text-sm leading-relaxed ${
              item.checked ? "line-through text-muted-foreground" : ""
            }`}
          >
            {item.text}
          </span>
        </label>
        {hasDesc && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            aria-label="설명 보기"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>
      {hasDesc && open && (
        <ul className="ml-7 mb-1 space-y-0.5">
          {item.descriptions.map((desc, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-relaxed">
              {desc}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
