"use client";

import { useEffect, useState } from "react";
import { formatElapsedTime } from "@/lib/today-queue-time";

export function useElapsedTime(startedAt: string | null, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled, startedAt]);

  return enabled ? formatElapsedTime(startedAt, now) : null;
}
