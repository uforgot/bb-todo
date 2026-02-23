"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListTodo, Archive, Timer, Activity, Brain, Sparkles } from "lucide-react";
import { useCron } from "@/hooks/use-cron";

export function BottomTabBar() {
  const pathname = usePathname();
  const { jobs } = useCron();
  const hasCronError = jobs.some((job) => (job.state?.consecutiveErrors ?? 0) > 0);

  return (
    <nav className="shrink-0 bg-background border-t" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex max-w-2xl mx-auto">
        <Link
          href="/"
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${
            pathname === "/" ? "text-foreground font-medium" : "text-muted-foreground"
          }`}
        >
          <ListTodo className="h-5 w-5" />
          Todo
        </Link>
        <Link
          href="/archive"
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${
            pathname === "/archive" ? "text-foreground font-medium" : "text-muted-foreground"
          }`}
        >
          <Archive className="h-5 w-5" />
          Archive
        </Link>
        <Link
          href="/cron"
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${
            pathname === "/cron" ? "text-foreground font-medium" : "text-muted-foreground"
          }`}
        >
          <div className="relative">
            <Timer className="h-5 w-5" />
            {hasCronError && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
            )}
          </div>
          Cron
        </Link>
        <Link
          href="/usage"
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${
            pathname === "/usage" ? "text-foreground font-medium" : "text-muted-foreground"
          }`}
        >
          <Activity className="h-5 w-5" />
          Usage
        </Link>
        <div className="w-px my-2 bg-muted-foreground/30" />
        <Link
          href="/bbang"
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${
            pathname === "/bbang" ? "text-foreground font-medium" : "text-muted-foreground"
          }`}
        >
          <Brain className="h-5 w-5" />
          빵빵
        </Link>
        <Link
          href="/pang"
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${
            pathname === "/pang" ? "text-foreground font-medium" : "text-muted-foreground"
          }`}
        >
          <Sparkles className="h-5 w-5" />
          팡팡
        </Link>
      </div>
    </nav>
  );
}
