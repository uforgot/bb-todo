"use client";

import useSWR from "swr";

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: string;
    expr?: string;
    tz?: string;
  };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
}

interface CronApiResponse {
  version: number;
  jobs: CronJob[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useCron() {
  const { data, error, isLoading } = useSWR<CronApiResponse>(
    "/api/cron",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1분 캐시
    }
  );

  return {
    jobs: data?.jobs ?? [],
    isLoading,
    isError: !!error,
  };
}
