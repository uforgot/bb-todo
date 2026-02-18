"use client";

import { useState } from "react";
import { useUsage, type ClaudeSummary, type KimiSummary, type UsageLog } from "@/hooks/use-usage";
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function ClaudeCard({ summary, onRefresh, isRefreshing }: { summary: ClaudeSummary; onRefresh?: () => void; isRefreshing?: boolean }) {
  const weeklyColor = summary.weekly_percentage >= 90
    ? "bg-red-500"
    : summary.weekly_percentage >= 70
      ? "bg-yellow-500"
      : "bg-blue-500";

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">Claude</span>
        <Badge variant="secondary" className="text-xs">{summary.plan} Plan</Badge>
      </div>

      {/* 현재 세션 */}
      <div className="space-y-2">
        <p className="text-sm font-medium">현재 세션</p>
        <p className="text-xs text-muted-foreground">{formatCountdown(summary.weekly_reset_time)}</p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ProgressBar
              percentage={summary.session_percentage}
              color="bg-blue-500"
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.session_percentage}% 사용됨</span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/30" />

      {/* 주간 한도 */}
      <div className="space-y-4">
        <p className="text-sm font-medium">주간 한도</p>

        {/* 모든 모델 */}
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

        {/* Sonnet만 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Sonnet만</p>
          <p className="text-xs text-muted-foreground">{formatResetTime(summary.weekly_reset_time)}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar percentage={summary.sonnet_weekly_percentage} color="bg-blue-500" />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.sonnet_weekly_percentage}% 사용됨</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">{formatNumber(summary.sonnet_weekly_tokens_used)}</p>
        </div>

        {/* Opus (only show if used) */}
        {summary.opus_weekly_tokens_used > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Opus</p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <ProgressBar percentage={summary.opus_weekly_percentage} color="bg-purple-500" />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{summary.opus_weekly_percentage}% 사용됨</span>
            </div>
            <p className="text-xs text-muted-foreground font-mono">{formatNumber(summary.opus_weekly_tokens_used)}</p>
          </div>
        )}
      </div>

      {/* Last updated */}
      <div className="pt-1 border-t border-border/30 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          마지막 업데이트: {formatRelativeTime(summary.last_updated)}
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>
    </div>
  );
}

function KimiCard({ summary, logs }: { summary: KimiSummary; logs: UsageLog[] }) {
  const kimiLogs = logs
    .filter((l) => l.provider === "kimi" && l.event_type === "daily")
    .slice(-30);

  const maxConsumed = Math.max(...kimiLogs.map((l) => l.consumed ?? 0), 0.01);

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">Kimi</span>
        <Badge variant="secondary" className="text-xs font-mono">${summary.current_balance.toFixed(2)}</Badge>
      </div>

      {/* Monthly total */}
      <div className="space-y-1">
        <p className="text-sm font-medium">월간 사용량</p>
        <p className="text-lg font-mono">${summary.monthly_consumed.toFixed(2)}</p>
      </div>

      {/* Daily consumption bars (last 30 days) */}
      {kimiLogs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">일별 소비 (최근 {kimiLogs.length}일)</p>
          <div className="flex items-end gap-px h-16">
            {kimiLogs.map((log, i) => {
              const height = maxConsumed > 0 ? ((log.consumed ?? 0) / maxConsumed) * 100 : 0;
              return (
                <div
                  key={i}
                  className="flex-1 bg-emerald-500/70 rounded-t-sm min-h-[2px]"
                  style={{ height: `${Math.max(height, 3)}%` }}
                  title={`${formatDate(log.recorded_at)}: $${(log.consumed ?? 0).toFixed(4)}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Last charge */}
      <div className="pt-1 border-t border-border/30">
        <p className="text-xs text-muted-foreground">
          마지막 충전: {formatDate(summary.last_charge)}
        </p>
      </div>
    </div>
  );
}

export function UsageSection() {
  const { logs, summary, isLoading, isError, refresh } = useUsage();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Usage 데이터를 불러올 수 없습니다
        </p>
      )}

      {!isLoading && !isError && !summary && (
        <p className="text-xs text-muted-foreground text-center py-8">
          Usage 데이터가 아직 없습니다. 크론이 데이터를 수집하면 여기에 표시됩니다.
        </p>
      )}

      {!isLoading && !isError && summary && (
        <div className="space-y-2">
          {summary.claude && <ClaudeCard summary={summary.claude} onRefresh={handleRefresh} isRefreshing={isRefreshing} />}
          {summary.kimi && <KimiCard summary={summary.kimi} logs={logs} />}
        </div>
      )}
    </div>
  );
}
