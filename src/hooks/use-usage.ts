"use client";

import useSWR from "swr";

export interface ClaudeSummary {
  plan: string;
  source?: string;
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

export interface KimiSummary {
  current_balance: number;
  cash_balance?: number;
  voucher_balance?: number;
  monthly_consumed: number;
  last_charge: string;
  currency: string;
}

export interface CodexQuotaSummary {
  provider: string;
  plan: string | null;
  five_hour_left_percent: number | null;
  five_hour_reset_in: string | null;
  week_left_percent: number | null;
  week_reset_in: string | null;
  source: string;
}

export interface OpenRouterSummary {
  total_credits: number;
  total_usage: number;
  remaining_credits: number;
  currency?: string;
  source: string;
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

export function useCodexQuota() {
  const { data, error, isLoading, mutate } = useSWR<{ codexQuota: CodexQuotaSummary; timestamp: string }>(
    "/api/usage/codex",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  return {
    codexQuota: data?.codexQuota ?? null,
    timestamp: data?.timestamp ?? null,
    isLoading,
    isError: !!error,
    refresh: () => mutate(),
  };
}

export function useOpenRouterUsage() {
  const { data, error, isLoading, mutate } = useSWR<{ openrouter: OpenRouterSummary; timestamp: string }>(
    "/api/usage/openrouter",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  return {
    openrouter: data?.openrouter ?? null,
    timestamp: data?.timestamp ?? null,
    isLoading,
    isError: !!error,
    refresh: () => mutate(),
  };
}
