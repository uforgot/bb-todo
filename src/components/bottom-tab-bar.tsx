"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListTodo, Archive, Timer } from "lucide-react";

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-10 bg-background border-t" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
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
          <Timer className="h-5 w-5" />
          Cron
        </Link>
      </div>
    </nav>
  );
}
