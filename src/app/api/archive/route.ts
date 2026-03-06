import { NextResponse } from "next/server";

const USAGE_API_URL = process.env.USAGE_API_URL || "https://ai.tail6603fc.ts.net";
const USAGE_API_KEY = process.env.USAGE_API_KEY || "";

export async function GET() {
  try {
    const res = await fetch(`${USAGE_API_URL.replace(/\/usage$/, "")}/archive`, {
      headers: { Authorization: `Bearer ${USAGE_API_KEY}` },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Archive API error: ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch archive";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const res = await fetch(`${USAGE_API_URL.replace(/\/usage$/, "")}/archive`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${USAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Archive API error: ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to archive items";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
