"use client";

import useSWR from "swr";

export interface KimiSummary {
  current_balance: number;
  cash_balance?: number;
  voucher_balance?: number;
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
  session_reset_time: string;
  weekly_reset_time: string;
  last_updated: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useClaudeUsage() {
  const { data, error, isLoading, mutate } = useSWR<{ claude: ClaudeSummary; timestamp: string }>(
    "/api/usage/claude",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  return {
    claude: data?.claude ?? null,
    timestamp: data?.timestamp ?? null,
    isLoading,
    isError: !!error,
    refresh: () => mutate(),
  };
}

export function useKimiUsage() {
  const { data, error, isLoading, mutate } = useSWR<{ kimi: KimiSummary; timestamp: string }>(
    "/api/usage/kimi",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  return {
    kimi: data?.kimi ?? null,
    timestamp: data?.timestamp ?? null,
    isLoading,
    isError: !!error,
    refresh: () => mutate(),
  };
}
