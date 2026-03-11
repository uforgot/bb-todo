"use client";

import { useMemoryHistory } from "@/hooks/use-memory-history";
import { useFileContent } from "@/hooks/use-file-content";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, useEffect } from "react";
import { useEmbedded } from "@/components/embedded-provider";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const mdComponents = {
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<"table">) => (
    <div className="overflow-x-auto mb-3 -mx-1">
      <table {...props}>{children}</table>
    </div>
  ),
};

const FILES = ["MEMORY.md", "SOUL.md", "AGENTS.md", "TOOLS.md"] as const;
type ViewMode = "content" | "diff";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
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

/* ── h2 accordion section for content view ── */
interface MdSection {
  heading: string;
  body: string;
}

function splitByH2(markdown: string): { intro: string; sections: MdSection[] } {
  const lines = markdown.split("\n");
  let intro = "";
  const sections: MdSection[] = [];
  let current: MdSection | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.replace(/^## /, ""), body: "" };
    } else if (current) {
      current.body += line + "\n";
    } else {
      intro += line + "\n";
    }
  }
  if (current) sections.push(current);

  return { intro: intro.trimEnd(), sections };
}

function AccordionMdSection({ section }: { section: MdSection }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-sm font-semibold">{section.heading}</span>
        <span className="text-xs text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-border/30">
          <div className="md-content prose-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{section.body}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Content view (본문) ── */
function ContentView({ repo, file }: { repo: string; file: string }) {
  const { content, isLoading, isError } = useFileContent(repo, file);
  const parsed = useMemo(() => (content ? splitByH2(content) : null), [content]);

  if (isLoading) {
    return (
      <div className="space-y-2 mb-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError || !parsed) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4 mb-4">
        불러올 수 없습니다
      </p>
    );
  }

  return (
    <div className="space-y-1.5 mb-4">
      {parsed.intro && (
        <div className="md-content prose-sm px-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{parsed.intro}</ReactMarkdown>
        </div>
      )}
      {parsed.sections.map((s, i) => (
        <AccordionMdSection key={i} section={s} />
      ))}
    </div>
  );
}

/* ── Diff view (변경 이력) ── */
function DiffView({ repo, file }: { repo: string; file: string }) {
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
                {formatTime(v.date)} · {v.sha.slice(0, 7)}
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


export function MemoryHistorySection({ repo }: { repo: string }) {
  const isEmbedded = useEmbedded();
  const [activeFile, setActiveFile] = useState<string>("MEMORY.md");
  const [viewMode, setViewMode] = useState<ViewMode>("content");

  // embedded 모드: URL 쿼리에서 file/mode 수신
  useEffect(() => {
    if (!isEmbedded) return;
    const params = new URLSearchParams(window.location.search);
    const file = params.get("file");
    const mode = params.get("mode");
    if (file && FILES.includes(file as typeof FILES[number])) {
      setActiveFile(file);
    }
    if (mode === "content" || mode === "diff") {
      setViewMode(mode);
    }
  }, [isEmbedded]);

  // embedded 모드: postMessage로 실시간 변경 수신
  useEffect(() => {
    if (!isEmbedded) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "setFile" && FILES.includes(e.data.file)) {
        setActiveFile(e.data.file);
      }
      if (e.data?.type === "setMode" && (e.data.mode === "content" || e.data.mode === "diff")) {
        setViewMode(e.data.mode);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isEmbedded]);

  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {/* File tabs — embedded 모드에서 숨김 */}
      {!isEmbedded && (
        <div className="flex gap-1 mb-2">
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
      )}

      {/* View mode toggle — embedded 모드에서 숨김 */}
      {!isEmbedded && (
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => setViewMode("content")}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              viewMode === "content"
                ? "bg-foreground text-background font-medium"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            본문
          </button>
          <button
            onClick={() => setViewMode("diff")}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              viewMode === "diff"
                ? "bg-foreground text-background font-medium"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            변경
          </button>
        </div>
      )}

      {viewMode === "content" ? (
        <ContentView repo={repo} file={activeFile} />
      ) : (
        <DiffView repo={repo} file={activeFile} />
      )}
    </div>
  );
}
