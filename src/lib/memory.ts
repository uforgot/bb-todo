const GITHUB_API = "https://api.github.com";

interface CommitEntry {
  sha: string;
  date: string;
  message: string;
}

interface MemoryVersion {
  sha: string;
  date: string;
  message: string;
  content: string;
}

function getToken() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  if (!token || !owner) throw new Error("Missing GitHub environment variables");
  return { token, owner };
}

export async function fetchMemoryHistory(
  repo: string,
  filePath: string,
  days: number = 7
): Promise<MemoryVersion[]> {
  const { token, owner } = getToken();

  const since = new Date();
  since.setDate(since.getDate() - days);

  // 1. Get commits for the file
  const commitsUrl = `${GITHUB_API}/repos/${owner}/${repo}/commits?path=${filePath}&per_page=20&since=${since.toISOString()}`;
  const commitsRes = await fetch(commitsUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
    cache: "no-store",
  });

  if (!commitsRes.ok) {
    if (commitsRes.status === 404) return [];
    throw new Error(`GitHub API error: ${commitsRes.status}`);
  }

  const commits: Array<{ sha: string; commit: { committer: { date: string }; message: string } }> = await commitsRes.json();

  // Deduplicate by date (keep latest commit per day)
  const byDate = new Map<string, CommitEntry>();
  for (const c of commits) {
    const date = c.commit.committer.date.slice(0, 10); // YYYY-MM-DD
    if (!byDate.has(date)) {
      byDate.set(date, {
        sha: c.sha,
        date,
        message: c.commit.message,
      });
    }
  }

  // 2. Fetch file content at each date's commit SHA
  const versions: MemoryVersion[] = [];
  for (const [, entry] of byDate) {
    try {
      const contentUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${entry.sha}`;
      const contentRes = await fetch(contentUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
        cache: "no-store",
      });

      if (!contentRes.ok) continue;

      const data = await contentRes.json();
      const content = Buffer.from(data.content, "base64").toString("utf-8");

      versions.push({
        sha: entry.sha,
        date: entry.date,
        message: entry.message,
        content,
      });
    } catch {
      continue;
    }
  }

  // Sort by date descending
  versions.sort((a, b) => b.date.localeCompare(a.date));
  return versions;
}
