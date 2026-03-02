import { NextResponse } from "next/server";
import { fetchCronJobs } from "@/lib/github";

export async function GET() {
  try {
    const content = await fetchCronJobs();
    const data = JSON.parse(content);
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch cron jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
