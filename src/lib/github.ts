const GITHUB_API = "https://api.github.com";

const MAX_RETRIES = 3;

interface GitHubFileResponse {
  content: string;
  sha: string;
  encoding: string;
}

function getConfig() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const path = process.env.GITHUB_FILE_PATH || "TODO.md";
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    throw new Error("Missing GitHub environment variables");
  }

  return { owner, repo, path, branch, token };
}

export async function fetchTodoMd(): Promise<{ content: string; sha: string }> {
  const { owner, repo, path, branch, token } = getConfig();

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

export async function updateTodoMd(
  content: string,
  sha: string
): Promise<{ sha: string; content: string }> {
  const { owner, repo, path, branch, token } = getConfig();

  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Update TODO.md via bb-todo",
        content: Buffer.from(content, "utf-8").toString("base64"),
        sha,
        branch,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return { sha: data.content.sha, content };
    }

    // 409 Conflict = SHA mismatch, retry with fresh SHA
    if (res.status === 409 && attempt < MAX_RETRIES - 1) {
      const delay = Math.pow(2, attempt) * 500; // 500ms, 1000ms, 2000ms
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Re-fetch to get the latest SHA and content, then re-apply changes
      const latest = await fetchTodoMd();
      sha = latest.sha;
      // The caller's content is based on the old version;
      // we return the conflict so the caller can re-apply toggles
      // on the fresh content.
      throw new ConflictError(latest.sha, latest.content);
    }

    const body = await res.json().catch(() => ({}));
    throw new Error(
      `GitHub update failed: ${res.status} ${body.message || res.statusText}`
    );
  }

  throw new Error("Max retries exceeded");
}

export class ConflictError extends Error {
  constructor(
    public latestSha: string,
    public latestContent: string
  ) {
    super("SHA conflict");
    this.name = "ConflictError";
  }
}

export async function fetchLastSyncTime(): Promise<string> {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    throw new Error("Missing GitHub environment variables");
  }

  const url = `${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=1`;

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
  return data[0]?.commit?.committer?.date ?? null;
}

export async function fetchCronJobs(): Promise<string> {
  const { owner, repo, branch, token } = getConfig();

  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/backup/cron-jobs.json?ref=${branch}`;

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
  return Buffer.from(data.content, "base64").toString("utf-8");
}
