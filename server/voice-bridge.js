// voice-bridge.js — bb-private 채널에서 [voice] 입력 감지 → 빵빵 답변 캡처 → Ably publish
const { Client, GatewayIntentBits, Events } = require("discord.js");
const Ably = require("ably");

const TOKEN = process.env.DISCORD_VOICE_BOT_TOKEN;
const ABLY_KEY = process.env.ABLY_ROOT_KEY;
const BB_CHANNEL_ID = process.env.BB_PRIVATE_CHANNEL_ID || "1502979840670961776";
const BB_USER_ID = process.env.BBANGBBANG_USER_ID || ""; // 빵빵 Discord user ID
const ABLY_CHANNEL = process.env.ABLY_VOICE_CHANNEL || "bb-voice";
const RESPONSE_TIMEOUT_MS = 30_000;

function cleanForVoice(text) {
  return (text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .split(/(?<=[.!?。!?])\s+/)
    .slice(0, 3)
    .join(" ")
    .trim();
}

function start() {
  if (!TOKEN || !ABLY_KEY) {
    console.warn("[voice-bridge] DISCORD_VOICE_BOT_TOKEN or ABLY_ROOT_KEY missing — disabled");
    return;
  }

  const ably = new Ably.Realtime(ABLY_KEY);
  const ablyChannel = ably.channels.get(ABLY_CHANNEL);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  let awaitingResponse = false;
  let armTimer = null;
  let selfId = null;

  client.once(Events.ClientReady, (c) => {
    selfId = c.user.id;
    console.log(`[voice-bridge] listener ready as ${c.user.tag} (${selfId})`);
    console.log(`[voice-bridge] watching channel ${BB_CHANNEL_ID}, ably channel "${ABLY_CHANNEL}"`);
    if (!BB_USER_ID) {
      console.warn("[voice-bridge] BBANGBBANG_USER_ID not set — will accept any bot msg in armed window (fallback)");
    }
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.channelId !== BB_CHANNEL_ID) return;
    if (msg.author.id === selfId) return;

    // User [voice] → arm
    if (!msg.author.bot && msg.content.trim().toLowerCase().startsWith("[voice]")) {
      awaitingResponse = true;
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        awaitingResponse = false;
        console.log("[voice-bridge] timeout — disarmed");
      }, RESPONSE_TIMEOUT_MS);
      console.log("[voice-bridge] armed for next 빵빵 response");
      return;
    }

    // 빵빵 response → publish & disarm
    if (!awaitingResponse) return;
    if (!msg.author.bot) return;
    if (BB_USER_ID && msg.author.id !== BB_USER_ID) {
      console.log(`[voice-bridge] ignored bot msg from ${msg.author.tag} (${msg.author.id}) — not 빵빵`);
      return;
    }

    const cleaned = cleanForVoice(msg.content);
    if (!cleaned) {
      console.log("[voice-bridge] empty after cleaning, skip");
      return;
    }

    awaitingResponse = false;
    if (armTimer) clearTimeout(armTimer);

    try {
      await ablyChannel.publish("reply", {
        text: cleaned,
        author_id: msg.author.id,
        author_tag: msg.author.tag,
        message_id: msg.id,
        ts: Date.now(),
      });
      console.log(`[voice-bridge] published from ${msg.author.tag}:`, cleaned.slice(0, 80));
    } catch (e) {
      console.error("[voice-bridge] ably publish error", e);
    }
  });

  client.login(TOKEN).catch((e) => console.error("[voice-bridge] login error", e));
}

module.exports = { start, cleanForVoice };
