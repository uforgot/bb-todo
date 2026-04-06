import { NextRequest, NextResponse } from "next/server";
import { assignSelfItems } from "../../../lib/assign-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const itemIds = body?.item_ids;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json({ error: "item_ids required" }, { status: 400 });
    }

    const data = await assignSelfItems(itemIds.map(Number));
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to assign self items";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
