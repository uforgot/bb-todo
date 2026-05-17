// relay-bridge.js — Discord 메시지 보조 핸들러
// voice-bridge가 만든 Discord client에 attach 해서 동작한다.
//
// 담당: 멘션 없는 followup 메시지 → 직전 등록된 봇에게 listener.reply()로 멘션 relay
//
// 사진 face 인식은 bb-app(Ably voice) 경로에서만 처리하므로 여기선 다루지 않는다.
// [voice] prefix 메시지와 봇 응답 캡처는 voice-bridge가 처리한다.

const { Events } = require("discord.js");

const vb = require("./voice-bridge");

function isVoicePrefix(msg) {
  return String(msg.content || "").trim().toLowerCase().startsWith("[voice]");
}

function mentionsConfiguredBot(msg, botsByDiscordId) {
  for (const userId of Object.keys(botsByDiscordId)) {
    if (msg.mentions.users.has(userId)) return true;
  }
  return false;
}

async function findPreviousConfiguredBotMessage(msg, byDiscordId, byKey) {
  try {
    const fetched = await msg.channel.messages.fetch({ limit: 15, before: msg.id });
    for (const prev of fetched.values()) {
      if (!prev.author?.bot) continue;
      const bot = vb.resolveConfiguredBotFromAuthor(prev.author, prev.member, byDiscordId, byKey);
      if (bot) return { prev, bot };
    }
  } catch (e) {
    console.warn("[relay-bridge] fetch previous messages failed:", e.message);
  }
  return null;
}

const RELAY_PROMPT = process.env.RELAY_PROMPT
  || "[Relayed] User didn't mention you directly. Read the referenced message (text + images) and reply naturally.";

async function relayViaReply(msg, targetBot) {
  if (!targetBot || !targetBot.discordUserId) return false;
  // listener bot이 user 메시지의 댓글(reply)로 멘션 + 짧은 prompt를 박는다.
  // 봇은 reply reference를 따라가서 원문(텍스트/이미지)을 직접 읽고 응답한다.
  await msg.reply({
    content: `<@${targetBot.discordUserId}> ${RELAY_PROMPT}`,
    allowedMentions: { users: [targetBot.discordUserId], repliedUser: false },
  });
  console.log(`[relay-bridge] relayed followup → ${targetBot.displayName}(${targetBot.discordUserId}) (as reply)`);
  return true;
}

async function resolveReplyTargetBot(msg, byDiscordId, byKey) {
  if (!msg.reference?.messageId) return null;
  try {
    const referenced = await msg.channel.messages.fetch(msg.reference.messageId);
    if (!referenced?.author?.bot) return null;
    return vb.resolveConfiguredBotFromAuthor(referenced.author, referenced.member, byDiscordId, byKey);
  } catch (e) {
    console.warn("[relay-bridge] fetch reply target failed:", e.message);
    return null;
  }
}

async function relayUnmentionedFollowup(msg) {
  if (msg.author.bot || msg.webhookId != null) return false;
  if (isVoicePrefix(msg)) return false;

  const text = String(msg.content || "").trim();
  const hasImage = Boolean(vb.firstImageAttachment(msg));
  if (!text && !hasImage) return false;

  const { byDiscordId, byKey } = vb.readBotsConfig();
  if (mentionsConfiguredBot(msg, byDiscordId)) return false;

  // Discord reply(댓글)로 봇 지정한 경우 → 그 봇으로 직행
  const replyTarget = await resolveReplyTargetBot(msg, byDiscordId, byKey);
  if (replyTarget) {
    return relayViaReply(msg, replyTarget);
  }

  // 일반 무멘션 → 직전 등록된 봇 찾아서 relay
  const hit = await findPreviousConfiguredBotMessage(msg, byDiscordId, byKey);
  if (!hit) return false;
  return relayViaReply(msg, hit.bot);
}

function attach(client, { isWatchedVoiceChannel } = {}) {
  if (!client) throw new Error("relay-bridge.attach: client required");
  const isWatched = isWatchedVoiceChannel || vb.isWatchedVoiceChannel;

  client.on(Events.MessageCreate, async (msg) => {
    if (!isWatched(msg)) return;

    try {
      await relayUnmentionedFollowup(msg);
    } catch (e) {
      console.error("[relay-bridge] followup relay error:", e.message);
    }
  });

  console.log("[relay-bridge] attached to discord client");
}

module.exports = { attach };
