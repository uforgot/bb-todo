"use client";

import useSWR from "swr";
import { parseTodoMd, type TodoSection } from "@/lib/parser";

interface TodoApiResponse {
  content: string;
  sha: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useTodo() {
  const { data, error, isLoading, mutate } = useSWR<TodoApiResponse>(
    "/api/todo",
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
    rawContent: data?.content ?? "",
    sha: data?.sha ?? "",
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}
