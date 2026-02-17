"use client";

import { Checkbox } from "@/components/ui/checkbox";
import type { TodoItem as TodoItemType } from "@/lib/parser";

interface TodoItemProps {
  item: TodoItemType;
  onToggle?: (lineIndex: number, checked: boolean) => void;
}

export function TodoItem({ item, onToggle }: TodoItemProps) {
  return (
    <label className="flex items-start gap-3 py-1.5 cursor-pointer">
      <Checkbox
        checked={item.checked}
        onCheckedChange={(checked) => {
          onToggle?.(item.line, !!checked);
        }}
        className="mt-0.5"
      />
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
