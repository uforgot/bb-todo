import { NextResponse } from "next/server";
import { listArchivedProjectsTree } from "../../../lib/todo-service";

export async function GET() {
  try {
    const data = await listArchivedProjectsTree();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch archive";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
