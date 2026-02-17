"use client";

import { Checkbox } from "@/components/ui/checkbox";
import type { TodoItem as TodoItemType } from "@/lib/parser";

interface TodoItemProps {
  item: TodoItemType;
}

export function TodoItem({ item }: TodoItemProps) {
  return (
    <label className="flex items-start gap-3 py-1.5 cursor-default">
      <Checkbox checked={item.checked} disabled className="mt-0.5" />
      <span
        className={`text-sm leading-relaxed ${
          item.checked ? "line-through text-muted-foreground" : ""
        }`}
      >
        {item.text}
      </span>
    </label>
  );
}
