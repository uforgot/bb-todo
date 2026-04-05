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

export interface CodexQuotaSummary {
  provider: string;
  plan: string | null;
  five_hour_left_percent: number | null;
  five_hour_reset_in: string | null;
  week_left_percent: number | null;
  week_reset_in: string | null;
  source: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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
