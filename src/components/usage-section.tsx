"use client";

import { useState, useEffect } from "react";
import { useClaudeUsage, useKimiUsage, type ClaudeSummary, type KimiSummary } from "@/hooks/use-usage";
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
  return `(${day}) ${period} ${h}:00에 재설정`;
}

function formatCountdown(resetTime: string): string {
  const now = new Date();
  const reset = new Date(resetTime);
  const diff = reset.getTime() - now.getTime();
  if (diff <= 0) return "리셋 완료";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}일 ${hours}시간 후 재설정`;
  if (hours > 0) return `${hours}시간 ${minutes}분 후 재설정`;
  return `${minutes}분 후 재설정`;
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

function ClaudeCard({ summary, onRefresh, isRefreshing }: { summary: ClaudeSummary; onRefresh: () => void; isRefreshing: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const weeklyColor = getBarColor(summary.weekly_percentage);
  const sessionColor = getBarColor(summary.session_percentage);
  const sonnetColor = getBarColor(summary.sonnet_weekly_percentage);
  const opusColor = getBarColor(summary.opus_weekly_percentage, "bg-purple-500");

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">Claude</span>
        <Badge variant="secondary" className="text-xs">{summary.plan} Plan</Badge>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">현재 세션</p>
        <p className="text-xs text-muted-foreground">{formatCountdown(summary.session_reset_time)}</p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ProgressBar percentage={summary.session_percentage} color={sessionColor} />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.session_percentage}% 사용됨</span>
        </div>
      </div>

      <div className="border-t border-border/30" />

      <div className="space-y-4">
        <p className="text-sm font-medium">주간 한도</p>

        <div className="space-y-1.5">
          <p className="text-xs font-medium">모든 모델</p>
          <p className="text-xs text-muted-foreground">{formatResetTime(summary.weekly_reset_time)}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar percentage={summary.weekly_percentage} color={weeklyColor} />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.weekly_percentage}% 사용됨</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">{formatNumber(summary.weekly_tokens_used)} / {formatNumber(summary.weekly_limit)}</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium">Sonnet만</p>
          <p className="text-xs text-muted-foreground">{formatResetTime(summary.weekly_reset_time)}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar percentage={summary.sonnet_weekly_percentage} color={sonnetColor} />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.sonnet_weekly_percentage}% 사용됨</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">{formatNumber(summary.sonnet_weekly_tokens_used)}</p>
        </div>

        {summary.opus_weekly_tokens_used > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Opus</p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <ProgressBar percentage={summary.opus_weekly_percentage} color={opusColor} />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.opus_weekly_percentage}% 사용됨</span>
            </div>
            <p className="text-xs text-muted-foreground font-mono">{formatNumber(summary.opus_weekly_tokens_used)}</p>
          </div>
        )}
      </div>

      <div className="pt-1 border-t border-border/30 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          마지막 업데이트: {formatRelativeTime(summary.last_updated)}
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
  const { claude, timestamp: claudeTs, isLoading: claudeLoading, isError: claudeError, refresh: refreshClaude } = useClaudeUsage();
  const { kimi, timestamp: kimiTs, isLoading: kimiLoading, isError: kimiError, refresh: refreshKimi } = useKimiUsage();

  const [claudeRefreshing, setClaudeRefreshing] = useState(false);
  const [kimiRefreshing, setKimiRefreshing] = useState(false);

  const handleClaudeRefresh = async () => {
    setClaudeRefreshing(true);
    await refreshClaude();
    setTimeout(() => setClaudeRefreshing(false), 500);
  };

  const handleKimiRefresh = async () => {
    setKimiRefreshing(true);
    await refreshKimi();
    setTimeout(() => setKimiRefreshing(false), 500);
  };

  const isLoading = claudeLoading || kimiLoading;
  const bothError = claudeError && kimiError;
  const hasData = claude || kimi;

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
          {claude && <ClaudeCard summary={claude} onRefresh={handleClaudeRefresh} isRefreshing={claudeRefreshing} />}
          {kimi && <KimiCard summary={kimi} timestamp={kimiTs} onRefresh={handleKimiRefresh} isRefreshing={kimiRefreshing} />}
        </div>
      )}
    </div>
  );
}
