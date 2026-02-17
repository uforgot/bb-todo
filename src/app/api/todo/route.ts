import { NextResponse } from "next/server";
import { fetchTodoMd } from "@/lib/github";

export async function GET() {
  try {
    const { content, sha } = await fetchTodoMd();
    return NextResponse.json({ content, sha });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch TODO.md";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
