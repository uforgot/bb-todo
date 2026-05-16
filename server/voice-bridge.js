// voice-bridge.js — bb-private 채널에서 [voice] 입력 감지 → 빵빵 답변 캡처 → Ably publish
const { Client, GatewayIntentBits, Events } = require("discord.js");
const Ably = require("ably");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const TOKEN = process.env.DISCORD_VOICE_BOT_TOKEN;
const ABLY_KEY = process.env.ABLY_ROOT_KEY;
const BB_CHANNEL_IDS = (process.env.BB_VOICE_CHANNEL_IDS || "1472162937648189615")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const BB_USER_ID = process.env.BBANGBBANG_USER_ID || "1471495923400970377"; // 빵빵 (legacy default mention)
const DEFAULT_BOT_KEY = "bbangbbang";
const ABLY_CHANNEL = process.env.ABLY_VOICE_CHANNEL || "bb-voice";
const VOICE_WEBHOOK_URL = process.env.DISCORD_VOICE_WEBHOOK_URL || ""; // hint 박을 webhook
const VOICE_CONFIG_PATH = path.join(__dirname, "voice-config.json");
const PLACES_API_URL = process.env.BB_ADMIN_PLACES_API_URL || "http://127.0.0.1:3000/api/places";
const PLACES_CACHE_TTL_MS = Number(process.env.PLACES_CACHE_TTL_MS || 30_000);
const FACE_CLI_PATH = process.env.FACE_CLI_PATH || path.join(process.env.HOME || "", ".openclaw/workspace/scripts/face");
const FACE_MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.4);
const DISCORD_IMAGE_DIR = path.join(__dirname, "images", "discord-face");
const DEFAULT_TIMEOUT_MS = 90_000;

const IMAGE_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

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

function readBotsConfig() {
  const cfg = readConfig();
  const bots = cfg && typeof cfg.bots === "object" ? cfg.bots : {};
  const defaultVoiceId = typeof cfg.voiceId === "string" ? cfg.voiceId : "";
  const byKey = {};
  const byDiscordId = {};
  for (const [key, raw] of Object.entries(bots)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = {
      key,
      displayName: raw.displayName || key,
      discordUserId: raw.discordUserId || "",
      voiceId: raw.voiceId || defaultVoiceId,
      gender: raw.gender || "",
      color: raw.color || "",
      ttsModel: typeof raw.ttsModel === "string" && raw.ttsModel.trim() ? raw.ttsModel : null,
      voiceSettings: raw.voiceSettings && typeof raw.voiceSettings === "object" ? raw.voiceSettings : null,
    };
    byKey[key] = entry;
    if (entry.discordUserId) byDiscordId[entry.discordUserId] = entry;
  }
  return { byKey, byDiscordId, defaultVoiceId };
}

function resolveBotForMention(mentionKey, botsByKey) {
  if (mentionKey && botsByKey[mentionKey]) return botsByKey[mentionKey];
  return botsByKey[DEFAULT_BOT_KEY] || null;
}

function readTimeoutMs() {
  const cfg = readConfig();
  const v = Number(cfg.bridgeTimeoutMs);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

let placesCache = { expiresAt: 0, places: [] };
const GEOCODE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACE_API_KEY || "";
const GEOCODE_CACHE_TTL_MS = Number(process.env.GEOCODE_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const geocodeCache = new Map(); // key: "lat4,lng4" → { name, expiresAt }

async function reverseGeocodeDong(location) {
  if (!GEOCODE_API_KEY) return "";
  const key = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
  const now = Date.now();
  const cached = geocodeCache.get(key);
  if (cached && cached.expiresAt > now) return cached.name;

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${location.lat},${location.lng}`);
    url.searchParams.set("language", "ko");
    url.searchParams.set("result_type", "sublocality_level_2");
    url.searchParams.set("key", GEOCODE_API_KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`geocode ${res.status}`);
    const data = await res.json();
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    const dong = first?.address_components?.find((c) => c.types?.includes("sublocality_level_2"))?.long_name || "";
    geocodeCache.set(key, { name: dong, expiresAt: now + GEOCODE_CACHE_TTL_MS });
    return dong;
  } catch (e) {
    console.warn("[voice-bridge] reverse geocode failed:", e.message);
    return "";
  }
}

function normalizeLocation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = Number(raw.accuracy);
  const ts = typeof raw.ts === "string" ? raw.ts : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    ts,
  };
}

function distanceMeters(a, b) {
  const toRad = (deg) => deg * Math.PI / 180;
  const earthRadiusM = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function fetchPlaces() {
  const now = Date.now();
  if (placesCache.expiresAt > now) return placesCache.places;

  const res = await fetch(PLACES_API_URL, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`places API ${res.status}`);
  const data = await res.json();
  const places = Array.isArray(data?.places) ? data.places : [];
  placesCache = { expiresAt: now + PLACES_CACHE_TTL_MS, places };
  return places;
}

async function resolveLocationLabel(rawLocation) {
  const location = normalizeLocation(rawLocation);
  if (!location) return "";

  let aliasName = "";
  try {
    const places = await fetchPlaces();
    let best = null;
    for (const place of places) {
      const lat = Number(place.lat);
      const lng = Number(place.lng);
      const radiusM = Number.isFinite(Number(place.radiusM)) ? Number(place.radiusM) : 100;
      if (!place?.name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const distanceM = distanceMeters(location, { lat, lng });
      if (distanceM <= radiusM && (!best || distanceM < best.distanceM)) {
        best = { name: String(place.name), distanceM, radiusM };
      }
    }
    if (best) {
      console.log(`[voice-bridge] location matched: ${best.name} (${Math.round(best.distanceM)}m/${best.radiusM}m)`);
      aliasName = best.name;
    }
  } catch (e) {
    console.warn("[voice-bridge] places lookup failed:", e.message);
  }

  const dong = await reverseGeocodeDong(location);
  if (aliasName && dong) return `${aliasName} (${dong})`;
  if (aliasName) return aliasName;
  if (dong) {
    console.log(`[voice-bridge] location geocoded: ${dong}`);
    return dong;
  }
  return "";
}

function buildTimeLabel(date = new Date()) {
  const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  const day = weekdays[date.getDay()];
  const h = date.getHours();
  let period;
  if (h >= 6 && h < 11) period = "오전";
  else if (h >= 11 && h < 14) period = "점심";
  else if (h >= 14 && h < 18) period = "오후";
  else if (h >= 18 && h < 22) period = "저녁";
  else period = "밤";
  return `${day} ${period}`;
}

async function buildVoiceRequestText(userText, { location, faceContext } = {}) {
  const locationLabel = await resolveLocationLabel(location);
  const hasLocation = Boolean(locationLabel);
  const hasPhoto = Boolean(faceContext);

  const voiceBullets = ["* speak in casual conversational tone"];
  if (hasLocation) voiceBullets.push("* reference Loc only when natural, don't state it directly");

  const timeLabel = buildTimeLabel();
  const dataLines = [];
  dataLines.push(`Time: ${timeLabel}`);
  if (hasLocation) dataLines.push(`Loc: ${locationLabel}`);
  if (hasPhoto) dataLines.push(`Photo: ${faceContext}`);
  dataLines.push(`User: ${userText}`);

  return `${voiceBullets.join("\n")}\n\n${dataLines.join("\n")}`;
}

async function prependLocationContext(text, rawLocation) {
  return buildVoiceRequestText(text, { location: rawLocation });
}

async function postViaWebhook(text, imageUrl, mentionKey) {
  if (!VOICE_WEBHOOK_URL) throw new Error("DISCORD_VOICE_WEBHOOK_URL not set");
  const attachment = resolveLocalImageAttachment(imageUrl);
  const imageLine = imageUrl && !attachment ? `\n${imageUrl}` : "";

  const { byKey } = readBotsConfig();
  const target = resolveBotForMention(mentionKey, byKey);
  const targetUserId = (target && target.discordUserId) || BB_USER_ID;
  const targetName = (target && target.displayName) || "빵빵";

  const payload = {
    content: `[voice] <@${targetUserId}>\n${text}${imageLine}`,
    username: "uforgot voice",
    allowed_mentions: { users: [targetUserId] },
  };
  console.log(`[voice-bridge] mention → ${targetName}(${targetUserId})`);

  const fetchOptions = attachment
    ? buildMultipartWebhookRequest(payload, attachment)
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      };

  const res = await fetch(VOICE_WEBHOOK_URL, fetchOptions);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST webhook ${res.status}: ${body.slice(0, 200)}`);
  }
}

function resolveLocalImageAttachment(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;

  let pathname = imageUrl.trim();
  try {
    if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith("/images/")) return null;
  const filename = path.basename(pathname.replace("/images/", ""));
  if (!filename || filename.includes("..")) return null;

  const filePath = path.join(__dirname, "images", filename);
  if (!fs.existsSync(filePath)) return null;

  const ext = path.extname(filename).toLowerCase();
  return {
    filename,
    filePath,
    contentType: IMAGE_MIME_TYPES[ext] || "application/octet-stream",
  };
}

function buildMultipartWebhookRequest(payload, attachment) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  const bytes = fs.readFileSync(attachment.filePath);
  form.append("files[0]", new Blob([bytes], { type: attachment.contentType }), attachment.filename);
  return { method: "POST", body: form };
}

function isImageAttachment(att) {
  if (!att) return false;
  const contentType = String(att.contentType || att.content_type || "").toLowerCase();
  const name = String(att.name || "").toLowerCase();
  return contentType.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic)$/i.test(name);
}

function firstImageAttachment(msg) {
  return msg.attachments.find(isImageAttachment) || null;
}

async function downloadDiscordAttachment(att) {
  fs.mkdirSync(DISCORD_IMAGE_DIR, { recursive: true });
  const ext = path.extname(att.name || "") || ".jpg";
  const safeExt = ext.match(/^\.[a-z0-9]+$/i) ? ext.toLowerCase() : ".jpg";
  const filePath = path.join(DISCORD_IMAGE_DIR, `${Date.now()}-${att.id}${safeExt}`);
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`attachment download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function formatFaceDiscordSummary(matchResult) {
  if (!matchResult || !matchResult.ok) return "얼굴 인식 실패.";
  const count = Number(matchResult.face_count || 0);
  if (!count) return "얼굴 감지 없음.";

  const results = matchResult.results || [];
  const labels = facePositionLabels(results);
  const knownNames = [];
  let hasUnknown = false;
  const parts = results.map((r, idx) => {
    const label = labels.get(idx) || `${idx + 1}번 얼굴`;
    const best = r.match || r.best_candidate;
    if (!best || typeof best.score !== "number" || best.score < FACE_MATCH_THRESHOLD) {
      hasUnknown = true;
      return `• ${label}: 미등록`;
    }
    knownNames.push(best.name);
    return `• ${label}: ${best.name}, ${faceConfidenceLabel(best.score)}`;
  });

  const commands = [];
  if (hasUnknown) commands.push("이름 등록");
  if (knownNames.length) commands.push(`${knownNames[0]} 샘플 추가`);
  const commandText = commands.length
    ? "\n\n명령어\n" + commands.map((cmd) => `\`${cmd}\``).join("\n")
    : "";
  return `얼굴 ${count}명\n${parts.join("\n")}${commandText}`;
}
function faceRegisterFailureMessage(name, result) {
  const code = result && result.code ? result.code : "unknown";
  if (code !== "quality_failed") return `${name} 등록 실패: ${code}`;
  const reasons = (result.quality && Array.isArray(result.quality.reasons)) ? result.quality.reasons : [];
  const labels = reasons.map((r) => ({
    face_too_blurry: "사진이 흐림",
    face_too_small: "얼굴이 작음",
    det_score_low: "얼굴 감지 점수가 낮음",
  }[r] || r));
  const reasonText = labels.length ? labels.join(", ") : "등록 품질 기준 미달";
  return `등록 실패
사유: ${reasonText}
다시 찍을 때: 얼굴이 크게 나오고 흔들리지 않은 정면 사진 권장`;
}

async function handleDirectDiscordFaceMessage(msg) {
  if (msg.author.bot) return false;

  const text = msg.content || "";
  const registerIntent = extractFaceRegisterIntent(text);

  let targetMessage = msg;
  let imageAttachment = firstImageAttachment(msg);

  if (registerIntent && !imageAttachment && msg.reference?.messageId) {
    try {
      targetMessage = await msg.channel.messages.fetch(msg.reference.messageId);
      imageAttachment = firstImageAttachment(targetMessage);
    } catch (e) {
      console.error("[voice-bridge] failed to fetch referenced image message:", e.message);
    }
  }

  if (registerIntent) {
    if (!imageAttachment) return false;
    const filePath = await downloadDiscordAttachment(imageAttachment);
    const personId = await resolvePersonIdByName(registerIntent.name);
    const people = await listFacePeople();
    const exists = people.some((p) => p.person_id === personId);
    const shouldSampleAdd = registerIntent.mode === "sample-add" || exists;
    const args = shouldSampleAdd
      ? ["sample-add", filePath, "--person-id", personId]
      : ["register", filePath, "--person-id", personId, "--name", registerIntent.name];
    const result = await runFaceCli(args);
    const reply = result && result.ok
      ? (shouldSampleAdd ? `샘플 추가 완료
이름: ${registerIntent.name}
현재 샘플: ${result.sample_count}장` : `등록 완료
이름: ${registerIntent.name}
현재 샘플: ${result.sample_count}장`)
      : faceRegisterFailureMessage(registerIntent.name, result);
    await msg.reply({ content: reply, allowedMentions: { repliedUser: false } });
    console.log(`[voice-bridge] direct discord face register: ${registerIntent.name} ok=${!!(result && result.ok)}`);
    return true;
  }

  if (imageAttachment) {
    const filePath = await downloadDiscordAttachment(imageAttachment);
    const result = await runFaceCli(["match", filePath, "--threshold", String(FACE_MATCH_THRESHOLD)]);
    await msg.reply({ content: formatFaceDiscordSummary(result), allowedMentions: { repliedUser: false } });
    console.log("[voice-bridge] direct discord face match handled");
    return true;
  }

  return false;
}

const ELEVENLABS_EMOTION_TAGS = new Set([
  "laugh", "laughs", "laughs softly",
  "happy", "warm", "calm", "whisper", "whispers",
  "sad", "surprised", "angry",
]);

function normalizeSquareBracketsForTTS(text) {
  return String(text || "").replace(/\[([^\]\n]{1,40})\]/g, (full, inner) => {
    const tag = String(inner || "").trim().toLowerCase();
    if (ELEVENLABS_EMOTION_TAGS.has(tag)) return full;
    return `(${inner})`;
  });
}

async function runFaceCli(args) {
  if (!FACE_CLI_PATH || !fs.existsSync(FACE_CLI_PATH)) return null;
  try {
    const { stdout } = await execFileAsync(FACE_CLI_PATH, args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(String(stdout || "{}").trim());
  } catch (e) {
    const out = String(e.stdout || "").trim();
    if (out) {
      try { return JSON.parse(out); } catch {}
    }
    return { ok: false, code: "face_cli_error", error: e.message };
  }
}

async function listFacePeople() {
  const res = await runFaceCli(["list"]);
  return res && res.ok && Array.isArray(res.people) ? res.people : [];
}

function normalizePersonName(name) {
  return String(name || "").trim().replace(/[\s님씨]+$/g, "");
}

function localPersonIdFromName(name) {
  return normalizePersonName(name)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || `person-${Date.now()}`;
}

async function resolvePersonIdByName(name) {
  const normalized = normalizePersonName(name);
  const people = await listFacePeople();
  const found = people.find((p) => {
    const names = [p.name, p.person_id, ...(Array.isArray(p.aliases) ? p.aliases : [])]
      .filter(Boolean)
      .map(normalizePersonName);
    return names.includes(normalized);
  });
  return found ? found.person_id : localPersonIdFromName(normalized);
}

function extractFaceRegisterIntent(text) {
  const t = String(text || "").trim();
  const sample = t.match(/^(.{2,20}?)\s*샘플\s*추가(?:해|해줘)?[.!?\s]*$/);
  if (sample) {
    const name = normalizePersonName(sample[1]);
    if (name && !/[?？]/.test(name) && !/(누구|뭐|무엇)/.test(name)) return { name, mode: "sample-add" };
  }
  const register = t.match(/^(.{2,20}?)\s+등록(?:해|해줘)?[.!?\s]*$/);
  if (register) {
    const name = normalizePersonName(register[1]);
    if (name && !/[?？]/.test(name) && !/(누구|뭐|무엇)/.test(name)) return { name, mode: "register" };
  }
  return null;
}

function faceConfidenceLabel(score) {
  if (score >= 0.7) return "거의 확실함";
  if (score >= 0.5) return "신뢰도 중간, 같은 사람으로 보임";
  if (score >= FACE_MATCH_THRESHOLD) return "신뢰도 낮음, 가능성만 있음";
  return "미상";
}

function facePositionLabels(results) {
  const list = (results || []).map((r, idx) => {
    const bbox = r.face && Array.isArray(r.face.bbox) ? r.face.bbox : null;
    const centerX = bbox ? (Number(bbox[0]) + Number(bbox[2])) / 2 : idx;
    return { idx, centerX };
  }).sort((a, b) => a.centerX - b.centerX);

  const labels = new Map();
  if (list.length === 1) {
    labels.set(list[0].idx, "얼굴");
  } else if (list.length === 2) {
    labels.set(list[0].idx, "왼");
    labels.set(list[1].idx, "오른");
  } else if (list.length === 3) {
    labels.set(list[0].idx, "왼");
    labels.set(list[1].idx, "가운데");
    labels.set(list[2].idx, "오른");
  } else {
    list.forEach((item, order) => labels.set(item.idx, `${order + 1}번`));
  }
  return labels;
}

function faceConfidenceShort(score) {
  if (score >= 0.7) return "high";
  if (score >= 0.5) return "mid";
  if (score >= FACE_MATCH_THRESHOLD) return "low";
  return "unknown";
}

function facePositionShort(idx, total) {
  if (total === 1) return "";
  if (total === 2) return idx === 0 ? "L" : "R";
  if (total === 3) return ["L", "C", "R"][idx];
  return `#${idx + 1}`;
}

function formatFaceMemoryContext(matchResult) {
  if (!matchResult || !matchResult.ok) return "";
  const count = Number(matchResult.face_count || 0);
  if (!count) return "";
  const results = matchResult.results || [];
  const sorted = (results || []).map((r, idx) => {
    const bbox = r.face && Array.isArray(r.face.bbox) ? r.face.bbox : null;
    const centerX = bbox ? (Number(bbox[0]) + Number(bbox[2])) / 2 : idx;
    return { r, centerX };
  }).sort((a, b) => a.centerX - b.centerX);
  const total = sorted.length;
  const parts = sorted.map(({ r }, idx) => {
    const label = facePositionShort(idx, total);
    const best = r.match || r.best_candidate;
    const prefix = label ? `${label}=` : "";
    if (!best || typeof best.score !== "number" || best.score < FACE_MATCH_THRESHOLD) {
      return `${prefix}unknown`;
    }
    return `${prefix}${best.name}(${faceConfidenceShort(best.score)})`;
  });
  return parts.join(", ");
}
async function buildFaceMemoryContext(imageUrl) {
  const attachment = resolveLocalImageAttachment(imageUrl);
  if (!attachment) return "";
  const result = await runFaceCli(["match", attachment.filePath, "--threshold", String(FACE_MATCH_THRESHOLD)]);
  return formatFaceMemoryContext(result);
}

async function handleFaceRegisterIntent(text, imageUrl, ablyChannel, mentionKey) {
  const intent = extractFaceRegisterIntent(text);
  if (!intent) return false;
  const attachment = resolveLocalImageAttachment(imageUrl);
  if (!attachment) return false;

  const { byKey } = readBotsConfig();
  const bot = resolveBotForMention(mentionKey, byKey) || byKey[DEFAULT_BOT_KEY] || {};
  const personId = await resolvePersonIdByName(intent.name);
  const people = await listFacePeople();
  const exists = people.some((p) => p.person_id === personId);
  const shouldSampleAdd = intent.mode === "sample-add" || exists;
  const args = shouldSampleAdd
    ? ["sample-add", attachment.filePath, "--person-id", personId]
    : ["register", attachment.filePath, "--person-id", personId, "--name", intent.name];
  const result = await runFaceCli(args);

  let reply;
  if (result && result.ok) {
    reply = shouldSampleAdd
      ? `${intent.name} 얼굴 샘플 추가했어. 현재 샘플 ${result.sample_count}장.`
      : `${intent.name} 얼굴 등록했어. 현재 샘플 ${result.sample_count}장.`;
  } else {
    const code = result && result.code ? result.code : "unknown";
    reply = `${intent.name} 얼굴 등록 실패. ${code}.`;
  }

  await ablyChannel.publish("reply", {
    text: reply,
    author_id: "face-memory",
    author_tag: "face-memory",
    message_id: `face-${Date.now()}`,
    ts: Date.now(),
    speaker: bot.key || DEFAULT_BOT_KEY,
    speaker_name: bot.displayName || "빵빵",
    speaker_color: bot.color || "#F59E0B",
    voice_id: bot.voiceId,
    tts_model: bot.ttsModel || undefined,
    voice_settings: bot.voiceSettings || undefined,
  });
  console.log(`[voice-bridge] face register intent handled: ${intent.name} (${personId}) ok=${!!(result && result.ok)}`);
  return true;
}

function cleanForVoice(text) {
  const sentences = normalizeSquareBracketsForTTS(text || "")
    // URL은 TTS에서 글자단위로 읽혀서 캐릭터 낭비됨. 호스트만 남기고 "링크"로 축약.
    .replace(/https?:\/\/(?:www\.)?([^\/\s]+)[^\s]*/g, (_, host) => `${host} 링크`)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\r/g, "")
    .replace(/\n+/g, ". ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/ㅋ+/g, "하하")
    .replace(/ㅎ+/g, "하하")
    .replace(/ㅠ+/g, "")
    .replace(/ㅜ+/g, "")
    .replace(/\bㅇㅋ\b/g, "오케이")
    .replace(/\bㄱㅅ\b/g, "고마워")
    .replace(/_/g, " ")
    // 일레븐랩스 TTS가 대시에서 문장 짤리는 이슈. em/en 대시랑 띄어쓰기로 둘러싸인 하이픈은 쉼표로 치환.
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+-\s+/g, ", ")
    // 일반 대괄호는 위에서 괄호로 치환. 감정 태그는 보존.
    .replace(/[\/\\|<>{}"`~^&*+=@#$%]/g, " ")
    .replace(/\s*[:;]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .split(/(?<=[.!?。!?])\s+/);
  const MAX_SENTENCES = 5;
  const truncated = sentences.length > MAX_SENTENCES;
  return (truncated
    ? sentences.slice(0, MAX_SENTENCES).join(" ") + " 뒤에 더 있어, 자세한 건 메시지로 봐줘."
    : sentences.join(" ")
  ).trim();
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
    const mention = typeof data === "object" && typeof data.mention === "string" ? data.mention : null;
    if (!text || typeof text !== "string") return;
    try {
      const trimmed = text.trim();
      // Registration is intentionally NOT handled inside voice requests.
      // Safer flow: send the photo to Discord, then reply to that photo message with
      // `이름 등록` or `이름 샘플 추가`. This avoids bots/voice text confusing register intent.
      const location = typeof data === "object" ? data.location : null;
      const faceContext = imageUrl ? await buildFaceMemoryContext(imageUrl) : "";
      const textWithContext = await buildVoiceRequestText(trimmed, { location, faceContext });
      await postViaWebhook(textWithContext, imageUrl, mention);
      console.log("[voice-bridge] forwarded to Discord:", trimmed.slice(0, 80), imageUrl ? "with image" : "");
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

    // Discord direct image upload/reply → face memory match/register.
    try {
      if (await handleDirectDiscordFaceMessage(msg)) return;
    } catch (e) {
      console.error("[voice-bridge] direct discord face handler error:", e.message);
      try {
        await msg.reply({ content: `얼굴 처리 실패: ${e.message}`, allowedMentions: { repliedUser: false } });
      } catch {}
      return;
    }

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

    // 봇 response → publish & disarm. 멀티봇: voice-config.json의 bots 매핑에 등록된 봇만 허용.
    if (!awaitingResponse) return;
    if (!msg.author.bot) return;

    const { byDiscordId, byKey } = readBotsConfig();
    let bot = byDiscordId[msg.author.id];
    // legacy: 매핑 없으면 빵빵 user id로 fallback
    if (!bot && msg.author.id === BB_USER_ID) bot = byKey[DEFAULT_BOT_KEY] || null;
    // discordUserId가 config에 비어있는 경우: 봇 username/displayName으로 fuzzy 매칭
    if (!bot) {
      const candidates = [
        msg.author.username,
        msg.author.globalName,
        msg.member?.displayName,
      ].filter(Boolean).map((s) => String(s).toLowerCase());
      for (const [key, entry] of Object.entries(byKey)) {
        const name = (entry.displayName || "").toLowerCase();
        if (!name) continue;
        if (candidates.some((c) => c.includes(name) || name.includes(c))) {
          bot = entry;
          console.log(`[voice-bridge] fuzzy-matched bot ${msg.author.tag} → ${key} (discordUserId not set in config)`);
          break;
        }
      }
    }
    if (!bot) {
      console.log(`[voice-bridge] ignored bot msg from ${msg.author.tag} (${msg.author.id}) — not in bots config`);
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
      const replyPayload = {
        text: cleaned,
        author_id: msg.author.id,
        author_tag: msg.author.tag,
        message_id: msg.id,
        ts: Date.now(),
        speaker: bot.key,
        speaker_name: bot.displayName,
        speaker_color: bot.color,
        voice_id: bot.voiceId,
      };
      if (bot.ttsModel) replyPayload.tts_model = bot.ttsModel;
      if (bot.voiceSettings) replyPayload.voice_settings = bot.voiceSettings;
      await ablyChannel.publish("reply", replyPayload);
      console.log(`[voice-bridge] published from ${bot.displayName}(${bot.key}):`, cleaned.slice(0, 80));
    } catch (e) {
      console.error("[voice-bridge] ably publish error", e);
    }
  });

  client.login(TOKEN).catch((e) => console.error("[voice-bridge] login error", e));
}

module.exports = { start, cleanForVoice, normalizeLocation, distanceMeters, resolveLocationLabel, buildVoiceRequestText, prependLocationContext };
