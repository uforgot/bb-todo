import { NextResponse } from "next/server";
import { fetchCronJobs } from "@/lib/github";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function fetchCronRunStates(): Promise<Record<string, { lastStatus: string; lastRunAtMs: number; lastDurationMs?: number; consecutiveErrors: number }>> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return {};

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cron_runs?select=job_id,status,error,duration_ms,ran_at&order=ran_at.desc&limit=200`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        next: { revalidate: 0 },
      }
    );
    if (!res.ok) return {};

    const rows: Array<{ job_id: string; status: string; error: string | null; duration_ms: number | null; ran_at: string }> = await res.json();

    // job_id별 최신 상태 집계
    const stateMap: Record<string, { lastStatus: string; lastRunAtMs: number; lastDurationMs?: number; consecutiveErrors: number }> = {};

    for (const row of rows) {
      if (!stateMap[row.job_id]) {
        // 첫 번째(최신) 행 = lastStatus
        stateMap[row.job_id] = {
          lastStatus: row.status,
          lastRunAtMs: new Date(row.ran_at).getTime(),
          lastDurationMs: row.duration_ms ?? undefined,
          consecutiveErrors: 0,
        };
      }
      // consecutiveErrors: 최신부터 연속 error 카운트
      if (stateMap[row.job_id].consecutiveErrors === rows.filter(r => r.job_id === row.job_id).indexOf(row) && row.status === "error") {
        stateMap[row.job_id].consecutiveErrors++;
      }
    }

    // consecutiveErrors 재계산 (최신부터 연속 에러 정확히 계산)
    const byJob: Record<string, typeof rows> = {};
    for (const row of rows) {
      if (!byJob[row.job_id]) byJob[row.job_id] = [];
      byJob[row.job_id].push(row);
    }
    for (const [jobId, jobRows] of Object.entries(byJob)) {
      let consecutive = 0;
      for (const r of jobRows) {
        if (r.status === "error") consecutive++;
        else break;
      }
      if (stateMap[jobId]) stateMap[jobId].consecutiveErrors = consecutive;
    }

    return stateMap;
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const [content, runStates] = await Promise.all([
      fetchCronJobs(),
      fetchCronRunStates(),
    ]);
    const data = JSON.parse(content);

    // cron-jobs.json의 각 job에 Supabase 실행 상태 주입
    if (data.jobs) {
      data.jobs = data.jobs.map((job: { id: string; state?: object }) => {
        const supaState = runStates[job.id];
        if (!supaState) return job;
        return {
          ...job,
          state: {
            ...job.state,
            lastStatus: supaState.lastStatus,
            lastRunAtMs: supaState.lastRunAtMs,
            lastDurationMs: supaState.lastDurationMs,
            consecutiveErrors: supaState.consecutiveErrors,
          },
        };
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch cron jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
