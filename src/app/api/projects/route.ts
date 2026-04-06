import { NextResponse } from "next/server";
import { listActiveProjectsTree } from "../../../lib/todo-service";

export async function GET() {
  try {
    const data = await listActiveProjectsTree();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch projects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
