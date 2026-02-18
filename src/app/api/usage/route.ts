import { NextResponse } from "next/server";

const USAGE_API_URL =
  process.env.USAGE_API_URL || "https://ai.tail6603fc.ts.net/usage";
const USAGE_API_KEY = process.env.USAGE_API_KEY || "";

export async function GET() {
  try {
    const res = await fetch(USAGE_API_URL, {
      headers: { Authorization: `Bearer ${USAGE_API_KEY}` },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Usage API error: ${res.status}`);
    }

    const live = await res.json();

    // Adapt to existing frontend shape
    return NextResponse.json({
      logs: [],
      summary: {
        claude: live.claude ?? null,
        kimi: live.kimi
          ? {
              current_balance: live.kimi.current_balance,
              monthly_consumed: 0,
              last_charge: "",
              currency: live.kimi.currency || "USD",
            }
          : null,
      },
      timestamp: live.timestamp ?? new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch usage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
