// relay-bridge.js — Discord 메시지 보조 핸들러
// voice-bridge가 만든 Discord client에 attach 해서 동작한다.
//
// 담당:
//  1. Discord 채널에 직접 올라온 사진 → face match/register
//  2. 멘션 없는 followup 메시지 → 직전 봇에게 webhook 멘션으로 relay
//
// [voice] prefix 메시지와 봇 응답 캡처는 voice-bridge가 처리하므로 여기선 무시한다.

const { Events } = require("discord.js");

const vb = require("./voice-bridge");

const VOICE_WEBHOOK_URL = process.env.DISCORD_VOICE_WEBHOOK_URL || "";

function isVoicePrefix(msg) {
  return String(msg.content || "").trim().toLowerCase().startsWith("[voice]");
}

async function handleDirectDiscordFaceMessage(msg) {
  if (msg.author.bot) return false;

  const text = msg.content || "";
  const registerIntent = vb.extractFaceRegisterIntent(text);

  let targetMessage = msg;
  let imageAttachment = vb.firstImageAttachment(msg);

  if (registerIntent && !imageAttachment && msg.reference?.messageId) {
    try {
      targetMessage = await msg.channel.messages.fetch(msg.reference.messageId);
      imageAttachment = vb.firstImageAttachment(targetMessage);
    } catch (e) {
      console.error("[relay-bridge] failed to fetch referenced image message:", e.message);
    }
  }

  if (registerIntent) {
    if (!imageAttachment) return false;
    const filePath = await vb.downloadDiscordAttachment(imageAttachment);
    const personId = await vb.resolvePersonIdByName(registerIntent.name);
    const people = await vb.listFacePeople();
    const exists = people.some((p) => p.person_id === personId);
    const shouldSampleAdd = registerIntent.mode === "sample-add" || exists;
    const args = shouldSampleAdd
      ? ["sample-add", filePath, "--person-id", personId]
      : ["register", filePath, "--person-id", personId, "--name", registerIntent.name];
    const result = await vb.runFaceCli(args);
    const reply = result && result.ok
      ? (shouldSampleAdd ? `샘플 추가 완료
이름: ${registerIntent.name}
현재 샘플: ${result.sample_count}장` : `등록 완료
이름: ${registerIntent.name}
현재 샘플: ${result.sample_count}장`)
      : vb.faceRegisterFailureMessage(registerIntent.name, result);
    await msg.reply({ content: reply, allowedMentions: { repliedUser: false } });
    console.log(`[relay-bridge] direct discord face register: ${registerIntent.name} ok=${!!(result && result.ok)}`);
    return true;
  }

  if (imageAttachment) {
    const filePath = await vb.downloadDiscordAttachment(imageAttachment);
    const result = await vb.runFaceCli(["match", filePath, "--threshold", String(vb.FACE_MATCH_THRESHOLD)]);
    const faceCount = Number((result && result.face_count) || 0);
    if (faceCount) {
      await vb.reactQuietly(msg, vb.hasKnownFace(result) ? "✅" : "❓");
      await msg.reply({ content: vb.formatFaceDiscordSummary(result), allowedMentions: { repliedUser: false } });
      console.log("[relay-bridge] direct discord face match handled");
    } else {
      console.log("[relay-bridge] direct discord face match: no face");
    }
    // face match는 followup 흐름을 막지 않는다 (사진+텍스트 같이 온 케이스 지원).
    return false;
  }

  return false;
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

async function postFollowupViaWebhook(text, targetBot, replyToMessageId) {
  if (!VOICE_WEBHOOK_URL) throw new Error("DISCORD_VOICE_WEBHOOK_URL not set");
  if (!targetBot || !targetBot.discordUserId) return false;

  const content = String(text || "").trim();
  if (!content) return false;

  const payload = {
    content: `<@${targetBot.discordUserId}> ${content}`,
    username: "uforgot relay",
    allowed_mentions: { users: [targetBot.discordUserId] },
  };
  if (replyToMessageId) {
    payload.message_reference = { message_id: replyToMessageId };
  }

  const res = await fetch(VOICE_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST relay webhook ${res.status}: ${body.slice(0, 200)}`);
  }
  console.log(`[relay-bridge] relayed followup → ${targetBot.displayName}(${targetBot.discordUserId})${replyToMessageId ? " (as reply)" : ""}`);
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

async function relayUnmentionedFollowup(msg, extraContext) {
  if (msg.author.bot || msg.webhookId != null) return false;
  if (isVoicePrefix(msg)) return false;

  const text = String(msg.content || "").trim();
  const hasImage = Boolean(vb.firstImageAttachment(msg));
  if (!text && !hasImage) return false;

  const { byDiscordId, byKey } = vb.readBotsConfig();
  if (mentionsConfiguredBot(msg, byDiscordId)) return false;

  // relay는 항상 user 메시지에 대한 댓글로 박힘 → 봇이 reference 따라가서 원문(이미지/캡션) 직접 봄.
  // 따라서 face 요약 같은 부가 컨텍스트는 안 넣고 user 입력만 그대로 forward.
  const relayContent = text || "봐봐";

  // Discord reply(댓글)로 봇 지정한 경우 → 그 봇으로 직행
  const replyTarget = await resolveReplyTargetBot(msg, byDiscordId, byKey);
  if (replyTarget) {
    return postFollowupViaWebhook(relayContent, replyTarget, msg.id);
  }

  // 일반 무멘션 → 직전 등록된 봇 찾아서 relay
  const hit = await findPreviousConfiguredBotMessage(msg, byDiscordId, byKey);
  if (!hit) return false;
  return postFollowupViaWebhook(relayContent, hit.bot, msg.id);
}

function attach(client, { isWatchedVoiceChannel } = {}) {
  if (!client) throw new Error("relay-bridge.attach: client required");
  const isWatched = isWatchedVoiceChannel || vb.isWatchedVoiceChannel;

  client.on(Events.MessageCreate, async (msg) => {
    if (!isWatched(msg)) return;

    // Discord 직접 사진 (face match/register)
    try {
      const faceResult = await handleDirectDiscordFaceMessage(msg);
      if (faceResult === true) return; // register: 종결
    } catch (e) {
      console.error("[relay-bridge] direct discord face handler error:", e.message);
      try {
        await msg.reply({ content: `얼굴 처리 실패: ${e.message}`, allowedMentions: { repliedUser: false } });
      } catch {}
      return;
    }

    // 무멘션 followup → 직전 봇에게 멘션 박아 webhook으로 relay
    try {
      await relayUnmentionedFollowup(msg);
    } catch (e) {
      console.error("[relay-bridge] followup relay error:", e.message);
    }
  });

  console.log("[relay-bridge] attached to discord client");
}

module.exports = { attach };
