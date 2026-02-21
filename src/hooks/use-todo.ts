"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { parseTodoMd, applyToggles, type TodoSection } from "@/lib/parser";
import { useBatchUpdate } from "@/hooks/use-batch-update";

interface TodoApiResponse {
  content: string;
  sha: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useTodo(onError?: (message: string) => void) {
  const { data, error, isLoading, mutate } = useSWR<TodoApiResponse>(
    "/api/todo",
    fetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  const shaRef = useRef("");
  useEffect(() => {
    if (data?.sha) {
      shaRef.current = data.sha;
    }
  }, [data?.sha]);

  const getSha = useCallback(() => shaRef.current, []);

  const onFlush = useCallback(
    async (toggles: Map<number, boolean>, sha: string) => {
      const res = await fetch("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sha,
          toggles: Array.from(toggles.entries()),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "업데이트에 실패했습니다");
      }

      const result: TodoApiResponse = await res.json();
      shaRef.current = result.sha;
      // Update SWR cache with the server response
      mutate(result, false);
    },
    [mutate]
  );

  const { queue, flush, isFlushing } = useBatchUpdate({
    debounceMs: 3000,
    onFlush: async (toggles, sha) => {
      // Snapshot for rollback
      const snapshot = data ? { ...data } : null;

      try {
        await onFlush(toggles, sha);
      } catch (err) {
        // Rollback: restore snapshot
        if (snapshot) {
          mutate(snapshot, false);
          shaRef.current = snapshot.sha;
        }
        onError?.(err instanceof Error ? err.message : "업데이트에 실패했습니다");
      }
    },
    getSha,
  });

  const toggle = useCallback(
    (lineIndex: number, checked: boolean) => {
      // Optimistic UI: update SWR cache immediately
      if (data) {
        const updatedContent = applyToggles(
          data.content,
          new Map([[lineIndex, checked]])
        );
        mutate({ ...data, content: updatedContent }, false);
      }

      // Queue for batched server update
      queue(lineIndex, checked);
    },
    [data, mutate, queue]
  );

  const sections: TodoSection[] = data?.content
    ? parseTodoMd(data.content)
    : [];

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    sections,
    rawContent: data?.content ?? "",
    sha: data?.sha ?? "",
    isLoading,
    isError: !!error,
    error,
    toggle,
    flush,
    refresh,
    mutate,
    isFlushing,
  };
}
