import { NextResponse } from "next/server";
import { clearDone } from "../../../../../lib/todo-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = Number(id);
    if (Number.isNaN(projectId)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const data = await clearDone(projectId);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear done";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
