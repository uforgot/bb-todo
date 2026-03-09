import { NextRequest } from "next/server";

const GITHUB_API = "https://api.github.com";
const ALLOWED_REPOS = ["bb-samsara", "pp-samsara"];
const ALLOWED_FILES = ["MEMORY.md", "SOUL.md", "AGENTS.md", "TOOLS.md"];

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const repo = searchParams.get("repo") ?? "bb-samsara";
  const file = searchParams.get("file") ?? "MEMORY.md";

  if (!ALLOWED_REPOS.includes(repo)) {
    return Response.json({ error: "Invalid repo" }, { status: 400 });
  }
  if (!ALLOWED_FILES.includes(file)) {
    return Response.json({ error: "Invalid file" }, { status: 400 });
  }

  const owner = process.env.GITHUB_OWNER;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !token) {
    return Response.json({ error: "Missing GitHub env" }, { status: 500 });
  }

  try {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${file}?ref=main`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return Response.json({ content });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
