"use client";

import { useMemoryHistory } from "@/hooks/use-memory-history";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

const FILES = ["MEMORY.md", "SOUL.md", "AGENTS.md"] as const;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function FileSection({ repo, file }: { repo: string; file: string }) {
  const { versions, isLoading, isError } = useMemoryHistory(repo, file);
  const [openDate, setOpenDate] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2 mb-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  }

  if (isError || versions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2 mb-4">
        {isError ? "불러올 수 없습니다" : "최근 7일 변경 이력 없음"}
      </p>
    );
  }

  return (
    <div className="space-y-1.5 mb-4">
      {versions.map((v) => {
        const isOpen = openDate === v.sha;
        return (
          <div key={v.sha} className="border border-border/50 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenDate(isOpen ? null : v.sha)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-sm font-medium">
                {formatDate(v.date)}
              </span>
              <span className="text-xs text-muted-foreground truncate ml-2 max-w-[60%]">
                {v.message}
              </span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 border-t border-border/30">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap mt-2 max-h-[60vh] overflow-y-auto leading-relaxed">
                  {v.content}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MemoryHistorySection({ repo }: { repo: string }) {
  const [activeFile, setActiveFile] = useState<string>("MEMORY.md");

  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {/* File tabs */}
      <div className="flex gap-1 mb-3">
        {FILES.map((file) => (
          <button
            key={file}
            onClick={() => setActiveFile(file)}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              activeFile === file
                ? "bg-foreground text-background font-medium"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {file.replace(".md", "")}
          </button>
        ))}
      </div>

      <FileSection repo={repo} file={activeFile} />
    </div>
  );
}
