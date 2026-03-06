"use client";

import useSWR from "swr";

export interface ArchiveItem {
  id: number;
  title: string;
  status: string;
  content: string | null;
  archivedAt: string | null;
}

export interface ArchiveCategory {
  id: number;
  name: string;
  items: ArchiveItem[];
}

export interface ArchiveProject {
  id: number;
  name: string;
  emoji: string | null;
  priority: number;
  categories: ArchiveCategory[];
  items: ArchiveItem[]; // uncategorized items
}

interface ArchiveApiResponse {
  projects: ArchiveProject[];
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

  return {
    projects: data?.projects ?? [],
    isLoading,
    isError: !!error,
    refresh: async () => { await mutate(); },
  };
}
