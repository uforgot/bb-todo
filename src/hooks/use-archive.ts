"use client";

import useSWR from "swr";
import { parseTodoMd, type TodoSection } from "@/lib/parser";

interface ArchiveApiResponse {
  content: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useArchive() {
  const { data, error, isLoading, mutate } = useSWR<ArchiveApiResponse>(
    "/api/archive",
    fetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  const sections: TodoSection[] = data?.content
    ? parseTodoMd(data.content)
    : [];

  return {
    sections,
    isLoading,
    isError: !!error,
    refresh: async () => { await mutate(); },
  };
}
