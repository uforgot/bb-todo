const GITHUB_API = "https://api.github.com";

interface GitHubFileResponse {
  content: string;
  sha: string;
  encoding: string;
}

export async function fetchTodoMd(): Promise<{ content: string; sha: string }> {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const path = process.env.GITHUB_FILE_PATH || "TODO.md";
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    throw new Error("Missing GitHub environment variables");
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

  const data: GitHubFileResponse = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");

  return { content, sha: data.sha };
}
