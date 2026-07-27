import "server-only";

const DEFAULT_USAGE_API_URL = "https://ai.tail6603fc.ts.net";

function getUsageApiBaseUrl() {
  const configuredUrl =
    process.env.USAGE_API_URL ||
    process.env.USAGE_API_BASE ||
    DEFAULT_USAGE_API_URL;

  return configuredUrl.replace(/\/usage\/?$/, "").replace(/\/$/, "");
}

export function fetchUsageApi(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${process.env.USAGE_API_KEY || ""}`);

  return fetch(`${getUsageApiBaseUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}
