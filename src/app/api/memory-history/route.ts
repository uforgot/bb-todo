import { fetchMemoryHistory } from "@/lib/memory";
import { NextRequest } from "next/server";

const ALLOWED_REPOS = ["bb-samsara", "pp-samsara"];
const ALLOWED_FILES = ["MEMORY.md", "SOUL.md", "AGENTS.md"];

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const repo = searchParams.get("repo") ?? "bb-samsara";
  const file = searchParams.get("file") ?? "MEMORY.md";
  const days = Number(searchParams.get("days") ?? "7");

  if (!ALLOWED_REPOS.includes(repo)) {
    return Response.json({ error: "Invalid repo" }, { status: 400 });
  }
  if (!ALLOWED_FILES.includes(file)) {
    return Response.json({ error: "Invalid file" }, { status: 400 });
  }

  try {
    const versions = await fetchMemoryHistory(repo, file, days);
    return Response.json(versions);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
