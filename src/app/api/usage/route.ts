import { NextResponse } from "next/server";
import { fetchUsageLogs } from "@/lib/github";

export async function GET() {
  try {
    const content = await fetchUsageLogs();
    const data = JSON.parse(content);
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch usage logs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
