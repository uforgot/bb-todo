import { NextRequest, NextResponse } from "next/server";

const USAGE_API_URL = process.env.USAGE_API_URL || "https://ai.tail6603fc.ts.net";
const USAGE_API_KEY = process.env.USAGE_API_KEY || "";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const res = await fetch(
      `${USAGE_API_URL.replace(/\/usage$/, "")}/api/items/${id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${USAGE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Items API error: ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update item";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
