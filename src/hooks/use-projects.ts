"use client";

import { useCallback } from "react";
import useSWR from "swr";

export interface ProjectItem {
  id: number;
  title: string;
  content: string | null;
  status: string;
  is_today: boolean;
}

export interface ProjectCategory {
  id: number;
  name: string;
  items: ProjectItem[];
}

export interface Project {
  id: number;
  emoji: string | null;
  name: string;
  priority: number;
  color: string | null;
  items: ProjectItem[];
  categories: ProjectCategory[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useProjects(onError?: (message: string) => void) {
  const { data, error, isLoading, mutate } = useSWR<Project[]>(
    "/api/projects",
    fetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );

  const projects = data ?? [];

  const toggle = useCallback(
    async (itemId: number, checked: boolean) => {
      const newStatus = checked ? "done" : "todo";

      // Optimistic UI
      mutate(
        (prev) =>
          prev?.map((p) => ({
            ...p,
            items: p.items.map((it) =>
              it.id === itemId ? { ...it, status: newStatus } : it
            ),
            categories: p.categories.map((c) => ({
              ...c,
              items: c.items.map((it) =>
                it.id === itemId ? { ...it, status: newStatus } : it
              ),
            })),
          })),
        false
      );

      try {
        const res = await fetch(`/api/items/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "업데이트에 실패했습니다");
        }
      } catch (err) {
        // Rollback
        mutate();
        onError?.(err instanceof Error ? err.message : "업데이트에 실패했습니다");
      }
    },
    [mutate, onError]
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  // Count totals
  let total = 0;
  let completed = 0;
  for (const p of projects) {
    for (const it of p.items) {
      total++;
      if (it.status === "done") completed++;
    }
    for (const c of p.categories) {
      for (const it of c.items) {
        total++;
        if (it.status === "done") completed++;
      }
    }
  }

  return {
    projects,
    total,
    completed,
    isLoading,
    isError: !!error,
    toggle,
    refresh,
  };
}
