import { NextRequest, NextResponse } from "next/server";
import { createProject, listActiveProjectsTree } from "../../../lib/todo-service";

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body?.name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const data = await createProject(body);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create project";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
