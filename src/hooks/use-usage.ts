"use client";

import useSWR from "swr";

export interface UsageLog {
  provider: string;
  balance?: number;
  consumed?: number;
  hours_elapsed?: number;
  event_type: string;
  charge_amount?: number | null;
  recorded_at: string;
}

export interface KimiSummary {
  current_balance: number;
  monthly_consumed: number;
  last_charge: string;
  currency: string;
}

export interface ClaudeSummary {
  plan: string;
  weekly_tokens_used: number;
  weekly_limit: number;
  weekly_percentage: number;
  sonnet_weekly_tokens_used: number;
  sonnet_weekly_percentage: number;
  opus_weekly_tokens_used: number;
  opus_weekly_percentage: number;
  session_percentage: number;
  weekly_reset_time: string;
  last_updated: string;
}

interface UsageApiResponse {
  logs: UsageLog[];
  summary: {
    kimi: KimiSummary;
    claude: ClaudeSummary;
  };
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useUsage() {
  const { data, error, isLoading } = useSWR<UsageApiResponse>(
    "/api/usage",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1분 캐시
    }
  );

  return {
    logs: data?.logs ?? [],
    summary: data?.summary ?? null,
    isLoading,
    isError: !!error,
  };
}
