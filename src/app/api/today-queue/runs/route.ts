import { NextRequest, NextResponse } from "next/server";
import { fetchUsageApi } from "@/lib/usage-api-proxy";

export async function GET(request: NextRequest) {
  try {
    const upstream = await fetchUsageApi(
      `/api/today-queue/runs${request.nextUrl.search}`
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
      error instanceof Error ? error.message : "Failed to fetch queue runs";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
