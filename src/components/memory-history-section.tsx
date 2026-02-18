"use client";

import { useMemoryHistory } from "@/hooks/use-memory-history";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import { useState } from "react";

const FILES = ["MEMORY.md", "SOUL.md", "AGENTS.md"] as const;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
}

function DiffLine({ line, type }: { line: string; type: "add" | "del" }) {
  const isHeader = line.startsWith("#");
  const isBold = line.startsWith("**") || line.startsWith("- **");

  return (
    <div
      className={`px-2 py-0.5 text-xs leading-relaxed rounded-sm ${
        type === "add"
          ? "bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500/40"
          : "bg-red-500/10 text-red-300/70 border-l-2 border-red-500/30 line-through"
      } ${isHeader ? "font-semibold text-sm mt-1" : ""} ${isBold ? "font-medium" : ""}`}
    >
      <span className="opacity-50 mr-1 select-none">{type === "add" ? "+" : "−"}</span>
      {line || "\u00A0"}
    </div>
  );
}

function FileSection({ repo, file }: { repo: string; file: string }) {
  const { versions, isLoading, isError } = useMemoryHistory(repo, file);
  const [openSha, setOpenSha] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2 mb-4">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError || versions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4 mb-4">
        {isError ? "불러올 수 없습니다" : "최근 7일 변경 없음"}
      </p>
    );
  }

  return (
    <div className="space-y-1.5 mb-4">
      {versions.map((v) => {
        const isOpen = openSha === v.sha;
        return (
          <div key={v.sha} className="border border-border/50 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenSha(isOpen ? null : v.sha)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{formatDate(v.date)}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                  +{v.additions.length}
                </span>
                {v.deletions.length > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                    −{v.deletions.length}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground ml-2">
                {v.sha.slice(0, 7)}
              </span>
            </button>
            {isOpen && (
              <div className="px-2 pb-2 border-t border-border/30 space-y-px mt-1 max-h-[60vh] overflow-y-auto">
                <p className="text-[11px] text-muted-foreground px-2 py-1.5 mb-1 bg-muted/20 rounded">
                  {v.message}
                </p>
                {v.additions.map((line, i) => (
                  <DiffLine key={`a-${i}`} line={line} type="add" />
                ))}
                {v.deletions.length > 0 && (
                  <>
                    <div className="h-px bg-border/30 my-1" />
                    {v.deletions.map((line, i) => (
                      <DiffLine key={`d-${i}`} line={line} type="del" />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const GITHUB_BASE = "https://github.com/uforgot";

export function MemoryHistorySection({ repo }: { repo: string }) {
  const [activeFile, setActiveFile] = useState<string>("MEMORY.md");
  const githubUrl = `${GITHUB_BASE}/${repo}/blob/main/${activeFile}`;

  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {/* GitHub link */}
      <div className="flex justify-end mb-2">
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          GitHub 원본
        </a>
      </div>

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
