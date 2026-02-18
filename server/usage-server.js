#!/usr/bin/env node
/**
 * Local Usage API Server
 * Exposes Claude (macOS plist) + Kimi (Moonshot API) usage data
 * Designed to run behind Tailscale Funnel
 */

const http = require("http");
const { execSync } = require("child_process");
const https = require("https");
const plist = require("simple-plist");
const fs = require("fs");
const path = require("path");

const PORT = process.env.USAGE_PORT || 3100;
const API_KEY = process.env.USAGE_API_KEY;
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY;

if (!API_KEY) {
  console.error("❌ USAGE_API_KEY is required");
  process.exit(1);
}

// --- Claude Usage (macOS plist) ---
function getClaudeUsage() {
  try {
    const plistPath = "/tmp/claude-usage-prefs.plist";
    execSync(
      "defaults export HamedElfayome.Claude-Usage /tmp/claude-usage-prefs.plist",
      { timeout: 5000 }
    );

    const data = plist.readFileSync(plistPath);
    const profiles = JSON.parse(
      Buffer.isBuffer(data.profiles_v3)
        ? data.profiles_v3.toString("utf-8")
        : data.profiles_v3 || "[]"
    );

    if (!profiles.length) return null;

    const cu = profiles[0].claudeUsage || {};
    const appleEpoch = new Date("2001-01-01T00:00:00Z");

    const resetTime = new Date(
      appleEpoch.getTime() + (cu.weeklyResetTime || 0) * 1000
    );
    const lastUpdated = new Date(
      appleEpoch.getTime() + (cu.lastUpdated || 0) * 1000
    );

    return {
      plan: "Max",
      weekly_tokens_used: cu.weeklyTokensUsed || 0,
      weekly_limit: cu.weeklyLimit || 0,
      weekly_percentage: cu.weeklyPercentage || 0,
      sonnet_weekly_tokens_used: cu.sonnetWeeklyTokensUsed || 0,
      sonnet_weekly_percentage: cu.sonnetWeeklyPercentage || 0,
      opus_weekly_tokens_used: cu.opusWeeklyTokensUsed || 0,
      opus_weekly_percentage: cu.opusWeeklyPercentage || 0,
      session_percentage: cu.sessionPercentage || 0,
      weekly_reset_time: resetTime.toISOString(),
      last_updated: lastUpdated.toISOString(),
    };
  } catch (e) {
    console.error("Claude usage error:", e.message);
    return null;
  }
}

// --- Kimi Balance (Moonshot API) ---
function getKimiBalance() {
  return new Promise((resolve) => {
    if (!MOONSHOT_API_KEY) {
      resolve(null);
      return;
    }

    const req = https.request(
      {
        hostname: "api.moonshot.ai",
        path: "/v1/users/me/balance",
        method: "GET",
        headers: { Authorization: `Bearer ${MOONSHOT_API_KEY}` },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const b = data.data;
            resolve({
              current_balance: parseFloat(b.available_balance) || 0,
              cash_balance: parseFloat(b.cash_balance) || 0,
              voucher_balance: parseFloat(b.voucher_balance) || 0,
              currency: "USD",
            });
          } catch (e) {
            console.error("Kimi parse error:", e.message);
            resolve(null);
          }
        });
      }
    );
    req.on("error", (e) => {
      console.error("Kimi request error:", e.message);
      resolve(null);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  // Auth check
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${API_KEY}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/usage" || url.pathname === "/usage/") {
      const [claude, kimi] = await Promise.all([
        getClaudeUsage(),
        getKimiBalance(),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ claude, kimi, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/claude") {
      const claude = getClaudeUsage();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ claude, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/usage/kimi") {
      const kimi = await getKimiBalance();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ kimi, timestamp: new Date().toISOString() }));
    } else if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (e) {
    console.error("Server error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal error" }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Usage API server running on port ${PORT}`);
});
