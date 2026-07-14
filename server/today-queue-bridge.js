// today-queue-bridge.js — DUDU_RESULT_V1 marker listener for Today Task Queue
// Keeps voice-bridge's request/reply state out of queue progression.

const { Client, GatewayIntentBits, Events } = require("discord.js");

const RESULT_MARKER = "DUDU_RESULT_V1";
const TASK_MARKER = "[DUDU_TASK_V1]";

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

function attach(client, { onResult, isAllowedChannel, logger = console } = {}) {
  if (!client) throw new Error("today-queue-bridge.attach: client required");
  if (typeof onResult !== "function") throw new Error("today-queue-bridge.attach: onResult callback required");

  client.on(Events.MessageCreate, async (msg) => {
    const marker = parseDuduResultMarker(msg.content);
    if (!marker) return;

    try {
      if (typeof isAllowedChannel === "function") {
        const allowed = await isAllowedChannel(msg, marker);
        if (!allowed) return;
      }
      const result = await onResult(msg, marker);
      if (result?.accepted) {
        logger.log(`[today-queue-bridge] accepted item #${marker.item_id} marker from ${msg.author?.tag || msg.author?.id || "unknown"}`);
      } else if (result?.reason) {
        logger.log(`[today-queue-bridge] ignored item #${marker.item_id || "?"}: ${result.reason}`);
      }
    } catch (error) {
      logger.error("[today-queue-bridge] result handler error:", error?.message || error);
    }
  });

  logger.log("[today-queue-bridge] attached to discord client");
}

function start({ token, onResult, isAllowedChannel, logger = console } = {}) {
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

  attach(client, { onResult, isAllowedChannel, logger });

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
  parseDuduResultMarker,
  attach,
  start,
};
