import { NextRequest, NextResponse } from "next/server";
import { fetchUsagePath } from "../shared";

const TTL_MS = 3 * 60 * 1000;

type OpenRouterCache = {
  openrouter: unknown | null;
  timestamp: string;
  fetchedAt: string;
};

let cache: OpenRouterCache | null = null;
let inflight: Promise<OpenRouterCache> | null = null;

async function fetchLive(): Promise<OpenRouterCache> {
  const live = await fetchUsagePath("/usage/openrouter");
  const now = new Date().toISOString();
  const next = {
    openrouter: live.openrouter ?? null,
    timestamp: live.timestamp ?? now,
    fetchedAt: now,
  };
  cache = next;
  return next;
}

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const now = Date.now();
  const isFresh = cache && now - new Date(cache.fetchedAt).getTime() < TTL_MS;

  if (!forceRefresh && isFresh) {
    return NextResponse.json({ ...cache, isStale: false, source: "cache" });
  }

  try {
    inflight ??= fetchLive().finally(() => {
      inflight = null;
    });
    const fresh = await inflight;
    return NextResponse.json({ ...fresh, isStale: false, source: "live" });
  } catch (error) {
    if (cache) {
      return NextResponse.json({ ...cache, isStale: true, source: "cache" });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch OpenRouter usage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
