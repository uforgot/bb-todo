"use client";

import { useCallback, useRef } from "react";

interface BatchUpdateOptions {
  /** Debounce window in ms (default: 3000) */
  debounceMs?: number;
  onFlush: (toggles: Map<number, boolean>, sha: string) => Promise<void>;
  getSha: () => string;
}

export function useBatchUpdate({
  debounceMs = 3000,
  onFlush,
  getSha,
}: BatchUpdateOptions) {
  const pendingRef = useRef<Map<number, boolean>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (pendingRef.current.size === 0 || flushingRef.current) return;

    flushingRef.current = true;
    const toggles = new Map(pendingRef.current);
    pendingRef.current.clear();

    try {
      await onFlush(toggles, getSha());
    } catch (err) {
      // Re-add failed toggles back to pending for next flush
      for (const [line, checked] of toggles) {
        if (!pendingRef.current.has(line)) {
          pendingRef.current.set(line, checked);
        }
      }
      throw err; // Re-throw so the caller can handle rollback
    } finally {
      flushingRef.current = false;
    }
  }, [onFlush, getSha]);

  const queue = useCallback(
    (lineIndex: number, checked: boolean) => {
      pendingRef.current.set(lineIndex, checked);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, debounceMs);
    },
    [debounceMs, flush]
  );

  const hasPending = useCallback(() => {
    return pendingRef.current.size > 0;
  }, []);

  return { queue, flush, hasPending };
}
