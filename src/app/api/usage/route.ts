import { NextResponse } from "next/server";
import { fetchUsagePath } from "./shared";

export async function GET() {
  try {
    const live = await fetchUsagePath("/usage");

    return NextResponse.json({
      logs: [],
      summary: {
        kimi: live.kimi
          ? {
              current_balance: live.kimi.current_balance,
              monthly_consumed: 0,
              last_charge: "",
              currency: live.kimi.currency || "USD",
            }
          : null,
      },
      codexQuota: live.codexQuota ?? null,
      kimi: live.kimi ?? null,
      timestamp: live.timestamp ?? new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch usage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
