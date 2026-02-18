"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useSyncTime() {
  const { data } = useSWR<{ lastSyncAt: string }>(
    "/api/sync-time",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  const lastSyncAt = data?.lastSyncAt ?? null;

  const label = lastSyncAt ? formatRelativeTime(new Date(lastSyncAt)) : null;

  return { label };
}

function formatRelativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "방금 동기화";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전 동기화`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전 동기화`;
  return `${Math.floor(diff / 86400)}일 전 동기화`;
}
