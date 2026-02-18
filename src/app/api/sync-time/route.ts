import { NextResponse } from "next/server";
import { fetchLastSyncTime } from "@/lib/github";

export async function GET() {
  try {
    const lastSyncAt = await fetchLastSyncTime();
    return NextResponse.json({ lastSyncAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch sync time";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
