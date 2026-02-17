import { NextResponse } from "next/server";

const GITHUB_API = "https://api.github.com";

export async function GET() {
  try {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const path = process.env.GITHUB_ARCHIVE_FILE_PATH || "TODO-archive.md";
    const branch = process.env.GITHUB_BRANCH || "main";
    const token = process.env.GITHUB_TOKEN;

    if (!owner || !repo || !token) {
      return NextResponse.json(
        { error: "Missing GitHub environment variables" },
        { status: 500 }
      );
    }

    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

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

    return NextResponse.json({ content });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch archive";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
