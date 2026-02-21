const GITHUB_API = "https://api.github.com";

export interface MemoryVersion {
  sha: string;
  date: string;
  message: string;
  additions: string[];
  deletions: string[];
}

function getToken() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  if (!token || !owner) throw new Error("Missing GitHub environment variables");
  return { token, owner };
}

interface CommitFile {
  filename: string;
  patch?: string;
}

interface CommitDetail {
  sha: string;
  commit: { committer: { date: string }; message: string };
  files?: CommitFile[];
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

  const allCommits = commits.map((c) => ({
    sha: c.sha,
    date: c.commit.committer.date,
    message: c.commit.message,
  }));

  // 2. Fetch each commit detail to get the patch
  const versions: MemoryVersion[] = [];
  for (const entry of allCommits) {
    try {
      const detailUrl = `${GITHUB_API}/repos/${owner}/${repo}/commits/${entry.sha}`;
      const detailRes = await fetch(detailUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
        cache: "no-store",
      });

      if (!detailRes.ok) continue;

      const detail: CommitDetail = await detailRes.json();
      const file = detail.files?.find((f) => f.filename === filePath);
      if (!file?.patch) continue;

      const lines = file.patch.split("\n");
      const additions = lines
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1));
      const deletions = lines
        .filter((l) => l.startsWith("-") && !l.startsWith("---"))
        .map((l) => l.slice(1));

      if (additions.length === 0 && deletions.length === 0) continue;

      versions.push({
        sha: entry.sha,
        date: entry.date,
        message: entry.message,
        additions,
        deletions,
      });
    } catch {
      continue;
    }
  }

  versions.sort((a, b) => b.date.localeCompare(a.date));
  return versions;
}
