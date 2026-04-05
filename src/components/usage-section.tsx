"use client";

import { useState } from "react";
import { useKimiUsage, useCodexQuota, type KimiSummary, type CodexQuotaSummary } from "@/hooks/use-usage";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

function getBarColor(percentage: number, base = "bg-blue-500"): string {
  if (percentage >= 90) return "bg-red-500";
  if (percentage >= 70) return "bg-yellow-500";
  return base;
}

function ProgressBar({ percentage, color = "bg-blue-500" }: { percentage: number; color?: string }) {
  return (
    <div className="h-2.5 w-full rounded-full bg-muted">
      <div
        className={`h-2.5 rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  );
}

function RefreshButton({ onClick, isRefreshing }: { onClick: () => void; isRefreshing: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={isRefreshing}
      className="text-muted-foreground hover:text-foreground transition-colors p-1"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
    </button>
  );
}

function CodexCard({ summary, timestamp, onRefresh, isRefreshing }: { summary: CodexQuotaSummary; timestamp: string | null; onRefresh: () => void; isRefreshing: boolean }) {
  const fiveUsed = summary.five_hour_left_percent != null ? 100 - summary.five_hour_left_percent : null;
  const weekUsed = summary.week_left_percent != null ? 100 - summary.week_left_percent : null;
  const fiveColor = getBarColor(fiveUsed ?? 0);
  const weekColor = getBarColor(weekUsed ?? 0, "bg-green-500");

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">Codex</span>
        <Badge variant="secondary" className="text-xs">{(summary.plan || "quota").replace(/\s*\(\$[\d.,]+\)?$/, "")}</Badge>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">5시간 quota</p>
          <p className="text-xs text-muted-foreground">{summary.five_hour_reset_in || "-"}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar percentage={fiveUsed ?? 0} color={fiveColor} />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.five_hour_left_percent ?? "-"}% 남음</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">주간 quota</p>
          <p className="text-xs text-muted-foreground">{summary.week_reset_in || "-"}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar percentage={weekUsed ?? 0} color={weekColor} />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.week_left_percent ?? "-"}% 남음</span>
          </div>
        </div>
      </div>

      <div className="pt-1 border-t border-border/30 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          마지막 업데이트: {timestamp ? formatRelativeTime(timestamp) : "-"}
        </p>
        <RefreshButton onClick={onRefresh} isRefreshing={isRefreshing} />
      </div>
    </div>
  );
}

function KimiCard({ summary, timestamp, onRefresh, isRefreshing }: { summary: KimiSummary; timestamp: string | null; onRefresh: () => void; isRefreshing: boolean }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">Kimi</span>
        <Badge variant="secondary" className="text-xs font-mono">${summary.current_balance.toFixed(2)}</Badge>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">잔액</p>
        <p className="text-2xl font-mono">${summary.current_balance.toFixed(2)}</p>
      </div>

      <div className="pt-1 border-t border-border/30 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          마지막 업데이트: {timestamp ? formatRelativeTime(timestamp) : "-"}
        </p>
        <RefreshButton onClick={onRefresh} isRefreshing={isRefreshing} />
      </div>
    </div>
  );
}

export function UsageSection() {
  const { codexQuota, timestamp: codexTs, isLoading: codexLoading, isError: codexError, refresh: refreshCodex } = useCodexQuota();
  const { kimi, timestamp: kimiTs, isLoading: kimiLoading, isError: kimiError, refresh: refreshKimi } = useKimiUsage();

  const [codexRefreshing, setCodexRefreshing] = useState(false);
  const [kimiRefreshing, setKimiRefreshing] = useState(false);

  const handleCodexRefresh = async () => {
    setCodexRefreshing(true);
    await refreshCodex();
    setTimeout(() => setCodexRefreshing(false), 500);
  };

  const handleKimiRefresh = async () => {
    setKimiRefreshing(true);
    await refreshKimi();
    setTimeout(() => setKimiRefreshing(false), 500);
  };

  const isLoading = codexLoading || kimiLoading;
  const bothError = codexError && kimiError;
  const hasData = codexQuota || kimi;

  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && bothError && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Usage 데이터를 불러올 수 없습니다
        </p>
      )}

      {!isLoading && !bothError && !hasData && (
        <p className="text-xs text-muted-foreground text-center py-8">
          Usage 데이터가 아직 없습니다.
        </p>
      )}

      {!isLoading && (
        <div className="space-y-2">
          {codexQuota && <CodexCard summary={codexQuota} timestamp={codexTs} onRefresh={handleCodexRefresh} isRefreshing={codexRefreshing} />}
          {kimi && <KimiCard summary={kimi} timestamp={kimiTs} onRefresh={handleKimiRefresh} isRefreshing={kimiRefreshing} />}
        </div>
      )}
    </div>
  );
}
