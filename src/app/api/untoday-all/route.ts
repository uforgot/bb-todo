import { NextRequest, NextResponse } from "next/server";
import { untodayAll } from "../../../lib/todo-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const data = await untodayAll(!!body?.done_only);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear today items";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
