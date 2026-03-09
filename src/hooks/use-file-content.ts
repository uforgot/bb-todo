import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useFileContent(repo: string, file: string) {
  const { data, error, isLoading } = useSWR<{ content: string }>(
    `/api/file-content?repo=${repo}&file=${file}`,
    fetcher,
    { refreshInterval: 300_000 }
  );

  return {
    content: data?.content ?? "",
    isLoading,
    isError: !!error || (data && "error" in data),
  };
}
