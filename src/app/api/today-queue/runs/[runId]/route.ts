import { NextResponse } from "next/server";
import { fetchUsageApi } from "@/lib/usage-api-proxy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const upstream = await fetchUsageApi(
      `/api/today-queue/runs/${encodeURIComponent(runId)}`
    );
    const body = await upstream.text();

    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch queue run";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
