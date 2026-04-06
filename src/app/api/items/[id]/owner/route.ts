import { NextRequest, NextResponse } from "next/server";
import { updateItemOwner } from "../../../../../lib/todo-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const itemId = Number(id);
    if (Number.isNaN(itemId)) {
      return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
    }

    const body = await request.json();
    const data = await updateItemOwner(itemId, body?.owner ?? null);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update item owner";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
