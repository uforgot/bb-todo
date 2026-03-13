import { NextResponse } from "next/server";

const USAGE_API_URL = process.env.USAGE_API_URL || "https://ai.tail6603fc.ts.net";
const USAGE_API_KEY = process.env.USAGE_API_KEY || "";

export async function GET() {
  try {
    const res = await fetch(`${USAGE_API_URL.replace(/\/usage$/, "")}/api/projects`, {
      headers: { Authorization: `Bearer ${USAGE_API_KEY}` },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Projects API error: ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch projects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
