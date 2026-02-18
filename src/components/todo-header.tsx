"use client";

import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, ListTodo, Moon, Sun } from "lucide-react";
import { useSyncTime } from "@/hooks/use-sync-time";

interface TodoHeaderProps {
  total: number;
  completed: number;
  countLabel?: string; // custom badge text (e.g. for cron page)
}

export function TodoHeader({ total, completed, countLabel }: TodoHeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { label: syncLabel } = useSyncTime();
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <header className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b px-4 py-3">
      <div className="flex items-center justify-between max-w-2xl mx-auto">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5" />
          {syncLabel && (
            <p className="text-[10px] text-muted-foreground">{syncLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={countLabel ? "secondary" : percentage === 100 ? "default" : "secondary"}>
            <CheckCircle className="h-3 w-3 mr-1" />
            {countLabel ?? `${completed}/${total} (${percentage}%)`}
          </Badge>
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
            aria-label="Toggle theme"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
