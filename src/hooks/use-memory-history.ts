import useSWR from "swr";

interface MemoryVersion {
  sha: string;
  date: string;
  message: string;
  content: string;
}

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
