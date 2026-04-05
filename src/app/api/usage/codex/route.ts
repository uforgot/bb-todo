import { NextResponse } from "next/server";
import { fetchUsagePath } from "../shared";

export async function GET() {
  try {
    const live = await fetchUsagePath("/usage/codex");
    return NextResponse.json({
      codexQuota: live.codexQuota ?? null,
      timestamp: live.timestamp ?? new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Codex usage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
