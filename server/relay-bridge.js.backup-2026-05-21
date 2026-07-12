// relay-bridge.js — Discord 메시지 보조 핸들러
// voice-bridge가 만든 Discord client에 attach 해서 동작한다.
//
// 담당: 멘션 없는 followup 메시지 → 직전 등록된 봇에게 원문+첨부를 복사해 멘션 relay
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

function mentionsAnyUser(msg) {
  return msg.mentions.users.size > 0;
}

async function findImmediatePreviousConfiguredBotMessage(msg, byDiscordId, byKey) {
  try {
    const fetched = await msg.channel.messages.fetch({ limit: 1, before: msg.id });
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

function collectAttachmentFiles(msg) {
  const files = [];
  for (const att of msg.attachments.values()) {
    if (!att?.url) continue;
    files.push({ attachment: att.url, name: att.name || undefined });
  }
  return files;
}

async function relayAsCopiedMessage(msg, targetBot) {
  if (!targetBot || !targetBot.discordUserId) return false;
  // Discord reply reference에 의존하지 않고, listener가 원문 텍스트와 첨부를 직접 복사한다.
  // 이렇게 해야 agent 입력이 댓글 컨텍스트/릴레이 프롬프트 없이 단순한 사용자 발화로 들어간다.
  const text = String(msg.content || "").trim();
  const content = text
    ? `<@${targetBot.discordUserId}> ${text}`
    : `<@${targetBot.discordUserId}>`;
  const files = collectAttachmentFiles(msg);
  await msg.channel.send({
    content,
    allowedMentions: { users: [targetBot.discordUserId], repliedUser: false },
    files: files.length ? files : undefined,
  });
  console.log(`[relay-bridge] relayed followup → ${targetBot.displayName}(${targetBot.discordUserId}) (copied${files.length ? `, ${files.length} attachment(s)` : ""})`);
  return true;
}

async function relayUnmentionedFollowup(msg) {
  if (msg.author.bot || msg.webhookId != null) return false;
  // Discord replies to a bot already reach the target agent through OpenClaw.
  // Relaying them here creates a duplicate listener mention for the same user message.
  if (msg.reference?.messageId) return false;
  if (isVoicePrefix(msg)) return false;

  const text = String(msg.content || "").trim();
  const hasImage = Boolean(vb.firstImageAttachment(msg));
  if (!text && !hasImage) return false;

  const { byDiscordId, byKey } = vb.readBotsConfig();
  if (mentionsConfiguredBot(msg, byDiscordId)) return false;
  if (mentionsAnyUser(msg)) return false;

  // 일반 무멘션 → 바로 직전 메시지가 등록된 봇일 때만 relay.
  // 전체 채널 relay에서 사람들 대화를 건너뛰고 더 오래된 봇을 잡으면 오발화가 난다.
  const hit = await findImmediatePreviousConfiguredBotMessage(msg, byDiscordId, byKey);
  if (!hit) return false;
  return relayAsCopiedMessage(msg, hit.bot);
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
