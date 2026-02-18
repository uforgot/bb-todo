import useSWR from "swr";
import type { MemoryVersion } from "@/lib/memory";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useMemoryHistory(repo: string, file: string) {
  const { data, error, isLoading } = useSWR<MemoryVersion[]>(
    `/api/memory-history?repo=${repo}&file=${file}&days=7`,
    fetcher,
    { refreshInterval: 300_000 } // 5 min cache
  );

  return {
    versions: data ?? [],
    isLoading,
    isError: !!error || (data && "error" in data),
  };
}
