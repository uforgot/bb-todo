"use client";

import { Badge } from "@/components/ui/badge";
import { CheckCircle, ListTodo } from "lucide-react";

interface TodoHeaderProps {
  total: number;
  completed: number;
}

export function TodoHeader({ total, completed }: TodoHeaderProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <header className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b px-4 py-3">
      <div className="flex items-center justify-between max-w-2xl mx-auto">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5" />
          <h1 className="text-lg font-semibold">bb-todo</h1>
        </div>
        <Badge variant={percentage === 100 ? "default" : "secondary"}>
          <CheckCircle className="h-3 w-3 mr-1" />
          {completed}/{total} ({percentage}%)
        </Badge>
      </div>
    </header>
  );
}
