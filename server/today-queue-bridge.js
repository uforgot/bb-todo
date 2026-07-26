// today-queue-bridge.js — DUDU_RESULT_V1 marker listener for Today Task Queue
// Keeps voice-bridge's request/reply state out of queue progression.

/* eslint-disable @typescript-eslint/no-require-imports */
const https = require("node:https");
const { Client, GatewayIntentBits, Events } = require("discord.js");

const RESULT_MARKER = "DUDU_RESULT_V1";
const TASK_MARKER = "[DUDU_TASK_V1]";
const FRAGMENT_TTL_MS = 2 * 60 * 1000;
const MAX_FRAGMENT_MESSAGES = 4;
const RECOVERY_INTERVAL_MS = 30 * 1000;
const RECOVERY_MESSAGE_LIMIT = 100;
const RECOVERY_MAX_PAGES = 10;

function normalizeMarkerKey(key) {
  return String(key || "").trim().toLowerCase().replace(/-/g, "_");
}

function parseDuduResultMarker(content) {
  const text = String(content || "");
  if (!text.includes(RESULT_MARKER)) return null;

  // Dispatch prompts contain the result marker template. Never treat the task packet itself as completion.
  if (text.includes(TASK_MARKER)) return null;

  const start = text.indexOf(RESULT_MARKER);
  const block = text.slice(start).replace(/\r/g, "");
  const lines = block.split("\n");
  const fields = {};

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line === "```") continue;
    if (line.startsWith("```")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    fields[normalizeMarkerKey(match[1])] = match[2].trim();
  }

  const itemId = Number.parseInt(fields.item_id || fields.item || "", 10);
  return {
    run_id: fields.run_id || fields.run || "",
    item_id: Number.isFinite(itemId) ? itemId : null,
    nonce: fields.nonce || "",
    status: fields.status || "",
    evidence: fields.evidence || "",
    raw: block.trim(),
  };
}

function isCompleteResultMarker(marker) {
  return Boolean(
    marker
      && marker.run_id
      && marker.item_id
      && marker.nonce
      && marker.status
      && /^\s*git_commit\s*:\s*\S+/im.test(marker.raw),
  );
}

function messageFragmentKey(msg) {
  const channelId = msg?.channelId || msg?.channel?.id;
  const authorId = msg?.author?.id;
  return channelId && authorId ? `${channelId}:${authorId}` : "";
}

function fetchDiscordChannelMessages(token, channelId, options = {}) {
  const query = new URLSearchParams({ limit: String(options.limit || RECOVERY_MESSAGE_LIMIT) });
  if (options.before) query.set("before", options.before);
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: "discord.com",
      path: `/api/v10/channels/${channelId}/messages?${query}`,
      headers: { Authorization: `Bot ${token}` },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Discord message recovery GET failed: ${res.statusCode}`));
          return;
        }
        try {
          const messages = JSON.parse(body);
          resolve(messages.map(msg => ({ ...msg, channelId: msg.channel_id || channelId })));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error("Discord message recovery GET timed out")));
    req.on("error", reject);
  });
}

function attach(client, {
  onResult,
  isAllowedChannel,
  getActiveItems,
  fetchMessages,
  recoveryIntervalMs = RECOVERY_INTERVAL_MS,
  logger = console,
} = {}) {
  if (!client) throw new Error("today-queue-bridge.attach: client required");
  if (typeof onResult !== "function") throw new Error("today-queue-bridge.attach: onResult callback required");

  const pendingFragments = new Map();
  let fragmentSequence = 0;
  let recoveryRunning = false;
  let recoveryAttempt = 0;

  const processMessage = async (candidate) => {
    let msg = candidate;
    try {
      if (msg?.partial && typeof msg.fetch === "function") msg = await msg.fetch();
      const content = String(msg?.content || "");
      const key = messageFragmentKey(msg);
      const now = Date.now();

      for (const [pendingKey, pending] of pendingFragments) {
        if (now - pending.updatedAt > FRAGMENT_TTL_MS) pendingFragments.delete(pendingKey);
      }

      let pending = key ? pendingFragments.get(key) : null;
      const startsResult = content.includes(RESULT_MARKER) && !content.includes(TASK_MARKER);

      if (startsResult && key) {
        pending = { fragments: new Map(), updatedAt: now };
        pendingFragments.set(key, pending);
      }

      if (pending) {
        fragmentSequence += 1;
        const messageId = msg?.id || `fragment-${fragmentSequence}`;
        const existing = pending.fragments.get(messageId);
        pending.fragments.set(messageId, {
          content,
          order: existing?.order ?? fragmentSequence,
        });
        pending.updatedAt = now;

        while (pending.fragments.size > MAX_FRAGMENT_MESSAGES) {
          const oldestId = [...pending.fragments.entries()]
            .sort((a, b) => a[1].order - b[1].order)[0]?.[0];
          if (!oldestId) break;
          pending.fragments.delete(oldestId);
        }
      }

      const combinedContent = pending
        ? [...pending.fragments.values()]
          .sort((a, b) => a.order - b.order)
          .map((fragment) => fragment.content)
          .join("\n")
        : content;
      const marker = parseDuduResultMarker(combinedContent);
      if (!marker) return null;
      if (!isCompleteResultMarker(marker)) return null;

      if (key) pendingFragments.delete(key);

      if (typeof isAllowedChannel === "function") {
        const allowed = await isAllowedChannel(msg, marker);
        if (!allowed) return null;
      }
      const result = await onResult(msg, marker);
      if (result?.accepted) {
        logger.log(`[today-queue-bridge] accepted item #${marker.item_id} marker from ${msg.author?.tag || msg.author?.id || "unknown"}`);
      } else if (result?.reason) {
        logger.log(`[today-queue-bridge] ignored item #${marker.item_id || "?"}: ${result.reason}`);
      }
      return result || null;
    } catch (error) {
      logger.error("[today-queue-bridge] result handler error:", error?.message || error);
    }
  };

  const recoverActiveResults = async () => {
    if (recoveryRunning || typeof getActiveItems !== "function") return;
    recoveryRunning = true;
    try {
      const activeItems = await getActiveItems();
      recoveryAttempt += 1;
      const activeIds = new Set((activeItems || []).map(item => Number(item.id)).filter(Number.isInteger));
      const channels = new Map();
      for (const item of activeItems || []) {
        if (!item.dispatch_channel_id) continue;
        const current = channels.get(item.dispatch_channel_id);
        const dispatchId = item.dispatch_message_id || null;
        if (!current || (dispatchId && (!current.earliestDispatchId || BigInt(dispatchId) < BigInt(current.earliestDispatchId)))) {
          channels.set(item.dispatch_channel_id, { earliestDispatchId: dispatchId });
        }
      }
      if (recoveryAttempt === 1) {
        logger.log(`[today-queue-bridge] recovery scan active=${activeItems?.length || 0} channels=${channels.size}`);
      }

      for (const [channelId, { earliestDispatchId }] of channels) {
        const channel = typeof fetchMessages === "function" ? null : await client.channels.fetch(channelId);
        if (!fetchMessages && !channel?.messages?.fetch) continue;
        let before;
        for (let page = 0; page < RECOVERY_MAX_PAGES; page += 1) {
          const options = {
            limit: RECOVERY_MESSAGE_LIMIT,
            ...(before ? { before } : {}),
          };
          const fetched = typeof fetchMessages === "function"
            ? await fetchMessages(channelId, options)
            : await channel.messages.fetch(options);
          const pageMessages = Array.isArray(fetched) ? fetched : [...fetched.values()];
          if (!pageMessages.length) break;
          const candidates = pageMessages
            .filter(msg => {
              const parsed = parseDuduResultMarker(msg.content);
              return parsed && activeIds.has(parsed.item_id);
            })
            .sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
          if (recoveryAttempt === 1) {
            logger.log(`[today-queue-bridge] recovery page=${page + 1} messages=${pageMessages.length} candidates=${candidates.length}`);
          }
          let accepted = false;
          for (const msg of candidates) {
            const result = await processMessage(msg);
            if (result?.accepted) {
              accepted = true;
              break;
            }
          }
          if (accepted) break;

          const oldestId = pageMessages.reduce((oldest, msg) => (
            !oldest || BigInt(msg.id) < BigInt(oldest) ? msg.id : oldest
          ), null);
          if (!oldestId || pageMessages.length < RECOVERY_MESSAGE_LIMIT) break;
          if (earliestDispatchId && BigInt(oldestId) <= BigInt(earliestDispatchId)) break;
          before = oldestId;
        }
      }
    } catch (error) {
      logger.error("[today-queue-bridge] recovery scan error:", error?.message || error);
    } finally {
      recoveryRunning = false;
    }
  };

  client.on(Events.MessageCreate, (msg) => {
    void processMessage(msg);
  });
  client.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
    void processMessage(newMessage);
  });
  client.once(Events.ClientReady, () => {
    void recoverActiveResults();
  });

  const recoveryTimer = typeof getActiveItems === "function" && recoveryIntervalMs > 0
    ? setInterval(() => void recoverActiveResults(), recoveryIntervalMs)
    : null;
  recoveryTimer?.unref?.();

  logger.log("[today-queue-bridge] attached to discord client");
  return { processMessage, recoverActiveResults, stop: () => recoveryTimer && clearInterval(recoveryTimer) };
}

function start({ token, onResult, isAllowedChannel, getActiveItems, recoveryIntervalMs, logger = console } = {}) {
  if (!token) {
    logger.warn("[today-queue-bridge] token missing — disabled");
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  attach(client, {
    onResult,
    isAllowedChannel,
    getActiveItems,
    fetchMessages: (channelId, options) => fetchDiscordChannelMessages(token, channelId, options),
    recoveryIntervalMs,
    logger,
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.log(`[today-queue-bridge] listener ready as ${readyClient.user.tag} (${readyClient.user.id})`);
  });

  client.login(token).catch((error) => {
    logger.error("[today-queue-bridge] login error:", error?.message || error);
  });

  return client;
}

module.exports = {
  RESULT_MARKER,
  TASK_MARKER,
  isCompleteResultMarker,
  parseDuduResultMarker,
  attach,
  start,
};
