"use client";

import { useCallback } from "react";
import useSWR from "swr";
import type { TodayQueueStatusResponse } from "@/lib/today-queue-types";

async function fetchQueueStatus(url: string): Promise<TodayQueueStatusResponse> {
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Queue status API error: ${response.status}`);
  }

  return response.json();
}

export function useTodayQueueDashboard(projectId?: number) {
  const query = projectId ? `?project_id=${projectId}` : "";
  const { data, error, isLoading, isValidating, mutate } =
    useSWR<TodayQueueStatusResponse>(
      `/api/today-queue/status${query}`,
      fetchQueueStatus,
      {
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
      }
    );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    status: data ?? null,
    projects: data?.projects ?? [],
    isLoading,
    isRefreshing: isValidating && Boolean(data),
    isError: Boolean(error),
    error: error instanceof Error ? error : null,
    refresh,
  };
}
