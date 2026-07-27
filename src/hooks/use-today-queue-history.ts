"use client";

import { useCallback, useEffect, useMemo } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import type {
  TodayQueueRunDetailResponse,
  TodayQueueRunListResponse,
  TodayQueueRunStatus,
} from "@/lib/today-queue-types";

async function fetchQueueHistory<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Queue history API error: ${response.status}`);
  }
  return response.json();
}

interface RunHistoryFilters {
  projectId: number | null;
  status: TodayQueueRunStatus | null;
  limit?: number;
}

export function useTodayQueueRunHistory({
  projectId,
  status,
  limit = 8,
}: RunHistoryFilters) {
  const getKey = useCallback(
    (pageIndex: number, previousPage: TodayQueueRunListResponse | null) => {
      if (previousPage && !previousPage.page.next_cursor) return null;
      const params = new URLSearchParams({ limit: String(limit) });
      if (projectId !== null) params.set("project_id", String(projectId));
      if (status !== null) params.set("status", status);
      if (pageIndex > 0 && previousPage?.page.next_cursor) {
        params.set("cursor", previousPage.page.next_cursor);
      }
      return `/api/today-queue/runs?${params}`;
    },
    [limit, projectId, status]
  );
  const { data, error, isLoading, isValidating, mutate, setSize, size } =
    useSWRInfinite<TodayQueueRunListResponse>(getKey, fetchQueueHistory, {
      revalidateFirstPage: false,
    });

  useEffect(() => {
    void setSize(1);
  }, [projectId, setSize, status]);

  const runs = useMemo(() => {
    const seen = new Set<string>();
    return (data ?? [])
      .flatMap((page) => page.runs)
      .filter((run) => {
        if (seen.has(run.id)) return false;
        seen.add(run.id);
        return true;
      });
  }, [data]);
  const lastPage = data?.[data.length - 1] ?? null;
  const hasMore = Boolean(lastPage?.page.has_more);
  const isLoadingMore =
    isValidating && Boolean(data) && typeof data?.[size - 1] === "undefined";

  return {
    runs,
    error: error instanceof Error ? error : null,
    isLoading,
    isRefreshing: isValidating && !isLoadingMore,
    isLoadingMore,
    hasMore,
    loadMore: () => setSize((current) => current + 1),
    refresh: () => mutate(),
  };
}

export function useTodayQueueRunDetail(runId: string | null) {
  const { data, error, isLoading, isValidating, mutate } =
    useSWR<TodayQueueRunDetailResponse>(
      runId ? `/api/today-queue/runs/${encodeURIComponent(runId)}` : null,
      fetchQueueHistory,
      { revalidateOnFocus: false }
    );

  return {
    detail: data ?? null,
    error: error instanceof Error ? error : null,
    isLoading,
    isRefreshing: isValidating && Boolean(data),
    refresh: () => mutate(),
  };
}
