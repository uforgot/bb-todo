"use client";

import { useState } from "react";
import {
  useClaudeUsage,
  useKimiUsage,
  useCodexQuota,
  useOpenRouterUsage,
  type ClaudeSummary,
  type KimiSummary,
  type CodexQuotaSummary,
  type OpenRouterSummary,
} from "@/hooks/use-usage";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function formatResetTime(resetTime: string): string {
  const reset = new Date(resetTime);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const day = days[reset.getDay()];
  const hours = reset.getHours();
  const period = hours < 12 ? "오전" : "오후";
  const h = hours <= 12 ? hours : hours - 12;
  return `(${day}) ${period} ${h}:00 리셋`;
}

function formatCountdown(resetTime: string): string {
  const now = new Date();
  const reset = new Date(resetTime);
  const diff = reset.getTime() - now.getTime();
  if (diff <= 0) return "리셋 완료";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}일 ${hours}시간 후`;
  if (hours > 0) return `${hours}시간 ${minutes}분 후`;
  return `${minutes}분 후`;
}

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

function ClaudeInfoRow({ label, value, subvalue }: { label: string; value: string; subvalue?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div className="space-y-0.5">
        <p className="font-medium">{label}</p>
        {subvalue && <p className="text-xs text-muted-foreground">{subvalue}</p>}
      </div>
      <p className="text-right text-muted-foreground whitespace-nowrap">{value}</p>
    </div>
  );
}

function ClaudeCard({ summary, timestamp, onRefresh, isRefreshing }: { summary: ClaudeSummary; timestamp: string | null; onRefresh: () => void; isRefreshing: boolean }) {
  const weeklyValue = summary.weekly_limit > 0
    ? `${summary.weekly_percentage}% · ${formatNumber(summary.weekly_tokens_used)} / ${formatNumber(summary.weekly_limit)}`
    : `${summary.weekly_percentage}% · ${formatNumber(summary.weekly_tokens_used)}`;

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">Claude</span>
        <Badge variant="secondary" className="text-xs">{summary.plan || "Plan"}</Badge>
      </div>

      <div className="space-y-3">
        <ClaudeInfoRow
          label="현재 세션"
          value={`${summary.session_percentage}% 사용`}
          subvalue={summary.session_reset_time ? formatCountdown(summary.session_reset_time) : undefined}
        />
        <ClaudeInfoRow
          label="주간 전체"
          value={weeklyValue}
          subvalue={summary.weekly_reset_time ? formatResetTime(summary.weekly_reset_time) : undefined}
        />
        {summary.sonnet_weekly_tokens_used > 0 && (
          <ClaudeInfoRow
            label="Sonnet"
            value={`${summary.sonnet_weekly_percentage}% · ${formatNumber(summary.sonnet_weekly_tokens_used)}`}
          />
        )}
        {summary.opus_weekly_tokens_used > 0 && (
          <ClaudeInfoRow
            label="Opus"
            value={`${summary.opus_weekly_percentage}% · ${formatNumber(summary.opus_weekly_tokens_used)}`}
          />
        )}
      </div>

      <div className="pt-1 border-t border-border/30 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          마지막 업데이트: {summary.last_updated ? formatRelativeTime(summary.last_updated) : timestamp ? formatRelativeTime(timestamp) : "-"}
        </p>
        <RefreshButton onClick={onRefresh} isRefreshing={isRefreshing} />
      </div>
    </div>
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
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-4 h-full">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">Kimi</span>
        <Badge variant="secondary" className="text-xs font-mono">${summary.current_balance.toFixed(2)}</Badge>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">잔액</p>
        <p className="text-2xl font-mono">${summary.current_balance.toFixed(2)}</p>
      </div>

      <div className="pt-1 border-t border-border/30 flex items-center justify-between mt-auto">
        <p className="text-xs text-muted-foreground">
          마지막 업데이트: {timestamp ? formatRelativeTime(timestamp) : "-"}
        </p>
        <RefreshButton onClick={onRefresh} isRefreshing={isRefreshing} />
      </div>
    </div>
  );
}

function OpenRouterCard({ summary, timestamp, onRefresh, isRefreshing }: { summary: OpenRouterSummary; timestamp: string | null; onRefresh: () => void; isRefreshing: boolean }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-4 h-full">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">OpenRouter</span>
        <Badge variant="secondary" className="text-xs font-mono">${summary.remaining_credits.toFixed(2)}</Badge>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">잔액</p>
        <p className="text-2xl font-mono">${summary.remaining_credits.toFixed(2)}</p>
      </div>

      <div className="pt-1 border-t border-border/30 flex items-center justify-between mt-auto">
        <p className="text-xs text-muted-foreground">
          마지막 업데이트: {timestamp ? formatRelativeTime(timestamp) : "-"}
        </p>
        <RefreshButton onClick={onRefresh} isRefreshing={isRefreshing} />
      </div>
    </div>
  );
}

export function UsageSection() {
  const { claude, timestamp: claudeTs, isLoading: claudeLoading, isError: claudeError, refresh: refreshClaude } = useClaudeUsage();
  const { codexQuota, timestamp: codexTs, isLoading: codexLoading, isError: codexError, refresh: refreshCodex } = useCodexQuota();
  const { kimi, timestamp: kimiTs, isLoading: kimiLoading, isError: kimiError, refresh: refreshKimi } = useKimiUsage();
  const { openrouter, timestamp: openrouterTs, isLoading: openrouterLoading, isError: openrouterError, refresh: refreshOpenRouter } = useOpenRouterUsage();

  const [claudeRefreshing, setClaudeRefreshing] = useState(false);
  const [codexRefreshing, setCodexRefreshing] = useState(false);
  const [kimiRefreshing, setKimiRefreshing] = useState(false);
  const [openrouterRefreshing, setOpenRouterRefreshing] = useState(false);

  const handleRefresh = async (setRefreshing: (value: boolean) => void, refresh: () => Promise<unknown>) => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 500);
  };

  const isLoading = claudeLoading || codexLoading || kimiLoading || openrouterLoading;
  const allError = claudeError && codexError && kimiError && openrouterError;
  const hasData = claude || codexQuota || kimi || openrouter;
  const hasLowerCards = kimi || openrouter;

  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && allError && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Usage 데이터를 불러올 수 없습니다
        </p>
      )}

      {!isLoading && !allError && !hasData && (
        <p className="text-xs text-muted-foreground text-center py-8">
          Usage 데이터가 아직 없습니다.
        </p>
      )}

      {!isLoading && (
        <div className="space-y-2">
          {codexQuota && (
            <CodexCard
              summary={codexQuota}
              timestamp={codexTs}
              onRefresh={() => handleRefresh(setCodexRefreshing, refreshCodex)}
              isRefreshing={codexRefreshing}
            />
          )}

          {hasLowerCards && (
            <div className="grid gap-2 md:grid-cols-2">
              {kimi && (
                <KimiCard
                  summary={kimi}
                  timestamp={kimiTs}
                  onRefresh={() => handleRefresh(setKimiRefreshing, refreshKimi)}
                  isRefreshing={kimiRefreshing}
                />
              )}
              {openrouter && (
                <OpenRouterCard
                  summary={openrouter}
                  timestamp={openrouterTs}
                  onRefresh={() => handleRefresh(setOpenRouterRefreshing, refreshOpenRouter)}
                  isRefreshing={openrouterRefreshing}
                />
              )}
            </div>
          )}

          {claude && (
            <>
              {hasLowerCards && <div className="border-t border-border/40 my-1" />}
              <ClaudeCard
                summary={claude}
                timestamp={claudeTs}
                onRefresh={() => handleRefresh(setClaudeRefreshing, refreshClaude)}
                isRefreshing={claudeRefreshing}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
