// voice-bridge.js — bb-private 채널에서 [voice] 입력 감지 → 빵빵 답변 캡처 → Ably publish
const { Client, GatewayIntentBits, Events } = require("discord.js");
const Ably = require("ably");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_VOICE_BOT_TOKEN;
const ABLY_KEY = process.env.ABLY_ROOT_KEY;
const BB_CHANNEL_IDS = (process.env.BB_VOICE_CHANNEL_IDS || "1472162937648189615")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const BB_USER_ID = process.env.BBANGBBANG_USER_ID || "1471495923400970377"; // 빵빵
const ABLY_CHANNEL = process.env.ABLY_VOICE_CHANNEL || "bb-voice";
const VOICE_WEBHOOK_URL = process.env.DISCORD_VOICE_WEBHOOK_URL || ""; // hint 박을 webhook
const VOICE_CONFIG_PATH = path.join(__dirname, "voice-config.json");
const DEFAULT_HINT = "[규칙: 5문장 이내, 평문, 영어 약어/마크다운/괄호 X, 한국어로만 답변, 짧은 문장으로 끊지 말고 쉼표로 이어 한 호흡으로]";
const DEFAULT_TIMEOUT_MS = 90_000;

function readConfig() {
  try {
    const raw = fs.readFileSync(VOICE_CONFIG_PATH, "utf8");
    const stripped = raw
      .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str || "");
    return JSON.parse(stripped);
  } catch {
    return {};
  }
}

function readPromptHint() {
  const cfg = readConfig();
  if (typeof cfg.promptHint === "string" && cfg.promptHint.trim()) return cfg.promptHint;
  return DEFAULT_HINT;
}

function readTimeoutMs() {
  const cfg = readConfig();
  const v = Number(cfg.bridgeTimeoutMs);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

async function postViaWebhook(text, imageUrl) {
  if (!VOICE_WEBHOOK_URL) throw new Error("DISCORD_VOICE_WEBHOOK_URL not set");
  const hint = readPromptHint();
  const imageLine = imageUrl ? `\n${imageUrl}` : "";
  const content = `[voice] ${hint} <@${BB_USER_ID}> ${text}${imageLine}`;
  const res = await fetch(VOICE_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      username: "uforgot voice",
      allowed_mentions: { users: [BB_USER_ID] },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST webhook ${res.status}: ${body.slice(0, 200)}`);
  }
}

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
    .replace(/ㅋ+/g, "하하")
    .replace(/ㅎ+/g, "하하")
    .replace(/ㅠ+/g, "")
    .replace(/ㅜ+/g, "")
    .replace(/\bㅇㅋ\b/g, "오케이")
    .replace(/\bㄱㅅ\b/g, "고마워")
    .replace(/_/g, " ")
    // 대괄호는 v3 감정 태그용으로 보존. 그 외 특수문자만 정리.
    .replace(/[\/\\|<>{}()"`~^&*+=@#$%]/g, " ")
    .replace(/\s*[:;]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
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

  // iOS → Ably "request" 이벤트 받으면 hint 박아 Discord webhook으로 post
  ablyChannel.subscribe("request", async (msg) => {
    const data = msg.data || {};
    const text = typeof data === "string" ? data : data.text;
    const imageUrl = typeof data === "object" && typeof data.image_url === "string" ? data.image_url : null;
    if (!text || typeof text !== "string") return;
    try {
      await postViaWebhook(text.trim(), imageUrl);
      console.log("[voice-bridge] forwarded to Discord:", text.slice(0, 80), imageUrl ? "with image" : "");
    } catch (e) {
      console.error("[voice-bridge] webhook post error:", e.message);
    }
  });

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
    console.log(`[voice-bridge] watching channels [${BB_CHANNEL_IDS.join(",")}], ably channel "${ABLY_CHANNEL}"`);
    console.log(`[voice-bridge] BB user id = ${BB_USER_ID || "(any bot)"}`);
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (!BB_CHANNEL_IDS.includes(msg.channelId)) return;
    if (msg.author.id === selfId) return;

    // User or webhook [voice] → arm (webhook은 author.bot=true지만 msg.webhookId 있음)
    const isUserOrWebhook = !msg.author.bot || msg.webhookId != null;
    if (isUserOrWebhook && msg.content.trim().toLowerCase().startsWith("[voice]")) {
      awaitingResponse = true;
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        awaitingResponse = false;
        console.log("[voice-bridge] timeout — disarmed");
      }, readTimeoutMs());
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
