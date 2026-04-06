import { NextRequest, NextResponse } from "next/server";
import { reorderProjects } from "../../../../lib/todo-service";

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const order = body?.order;
    if (!Array.isArray(order)) {
      return NextResponse.json({ error: "order required" }, { status: 400 });
    }

    const data = await reorderProjects(order.map(Number));
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reorder projects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
