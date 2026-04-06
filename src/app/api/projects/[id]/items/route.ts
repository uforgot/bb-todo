import { NextRequest, NextResponse } from "next/server";
import { createItem } from "../../../../../lib/todo-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = Number(id);
    if (Number.isNaN(projectId)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const body = await request.json();
    if (!body?.title) {
      return NextResponse.json({ error: "title required" }, { status: 400 });
    }

    const data = await createItem(projectId, body);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create item";
    const detail = error && typeof error === "object" ? error : null;
    return NextResponse.json({ error: message, detail }, { status: 500 });
  }
}
