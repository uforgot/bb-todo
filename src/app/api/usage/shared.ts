const USAGE_API_BASE = process.env.USAGE_API_BASE || "https://ai.tail6603fc.ts.net";
const USAGE_API_KEY = process.env.USAGE_API_KEY || "";

export async function fetchUsagePath(path: string) {
  const res = await fetch(`${USAGE_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${USAGE_API_KEY}` },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Usage API error: ${res.status}`);
  }

  return res.json();
}
