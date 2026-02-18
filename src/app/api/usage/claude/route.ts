import { NextResponse } from "next/server";

const BASE_URL = process.env.USAGE_API_URL?.replace(/\/usage\/?$/, "") || "https://ai.tail6603fc.ts.net";
const API_KEY = process.env.USAGE_API_KEY || "";

export async function GET() {
  try {
    const res = await fetch(`${BASE_URL}/usage/claude`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Usage API error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
