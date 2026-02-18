"use client";

import { useUsage, type ClaudeSummary, type KimiSummary, type UsageLog } from "@/hooks/use-usage";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function formatCountdown(resetTime: string): string {
  const now = new Date();
  const reset = new Date(resetTime);
  const diff = reset.getTime() - now.getTime();
  if (diff <= 0) return "리셋 완료";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}일 ${hours}시간 후 리셋`;
  return `${hours}시간 후 리셋`;
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

function ProgressBar({ percentage, color }: { percentage: number; color: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div
        className={`h-2 rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  );
}

function ClaudeCard({ summary }: { summary: ClaudeSummary }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Claude</span>
        <Badge variant="secondary" className="text-xs">{summary.plan} Plan</Badge>
      </div>

      {/* Weekly usage */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">주간 사용량</span>
          <span className="font-mono">{formatNumber(summary.weekly_tokens_used)} / {formatNumber(summary.weekly_limit)}</span>
        </div>
        <ProgressBar
          percentage={summary.weekly_percentage}
          color={summary.weekly_percentage >= 90 ? "bg-destructive" : summary.weekly_percentage >= 70 ? "bg-yellow-500" : "bg-primary"}
        />
        <p className="text-xs text-muted-foreground text-right">{summary.weekly_percentage}%</p>
      </div>

      {/* Model breakdown */}
      <div className="space-y-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Sonnet</span>
            <span className="font-mono">{formatNumber(summary.sonnet_weekly_tokens_used)} ({summary.sonnet_weekly_percentage}%)</span>
          </div>
          <ProgressBar percentage={summary.sonnet_weekly_percentage} color="bg-blue-500" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Opus</span>
            <span className="font-mono">{formatNumber(summary.opus_weekly_tokens_used)} ({summary.opus_weekly_percentage}%)</span>
          </div>
          <ProgressBar percentage={summary.opus_weekly_percentage} color="bg-purple-500" />
        </div>
      </div>

      {/* Session & Reset */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/30">
        <span>세션 {summary.session_percentage}%</span>
        <span>{formatCountdown(summary.weekly_reset_time)}</span>
      </div>

      {/* Last updated */}
      <p className="text-[10px] text-muted-foreground text-right">
        업데이트: {formatDate(summary.last_updated)}
      </p>
    </div>
  );
}

function KimiCard({ summary, logs }: { summary: KimiSummary; logs: UsageLog[] }) {
  const kimiLogs = logs
    .filter((l) => l.provider === "kimi" && l.event_type === "daily")
    .slice(0, 30);

  const maxConsumed = Math.max(...kimiLogs.map((l) => l.consumed ?? 0), 0.01);

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Kimi</span>
        <Badge variant="secondary" className="text-xs font-mono">${summary.current_balance.toFixed(2)}</Badge>
      </div>

      {/* Monthly total */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">월간 사용량</span>
        <span className="font-mono">${summary.monthly_consumed.toFixed(2)}</span>
      </div>

      {/* Daily consumption bars (last 30 days) */}
      {kimiLogs.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">일별 소비 (최근 {kimiLogs.length}일)</p>
          <div className="flex items-end gap-px h-12">
            {kimiLogs.map((log, i) => {
              const height = maxConsumed > 0 ? ((log.consumed ?? 0) / maxConsumed) * 100 : 0;
              return (
                <div
                  key={i}
                  className="flex-1 bg-emerald-500/70 rounded-t-sm min-h-[1px]"
                  style={{ height: `${Math.max(height, 2)}%` }}
                  title={`${formatDate(log.recorded_at)}: $${(log.consumed ?? 0).toFixed(2)}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Last charge */}
      <p className="text-[10px] text-muted-foreground text-right">
        마지막 충전: {formatDate(summary.last_charge)}
      </p>
    </div>
  );
}

export function UsageSection() {
  const { logs, summary, isLoading, isError } = useUsage();

  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
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
          Usage 데이터가 아직 없습니다
        </p>
      )}

      {!isLoading && !isError && summary && (
        <div className="space-y-2">
          <ClaudeCard summary={summary.claude} />
          <KimiCard summary={summary.kimi} logs={logs} />
        </div>
      )}
    </div>
  );
}
