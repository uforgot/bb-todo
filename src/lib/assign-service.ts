import fs from "fs";
import https from "https";
import path from "path";
import { getSupabaseAdmin } from "./supabase-admin";

const IMAGES_DIR = path.join(process.cwd(), "server", "images");
const BBANG_DISCORD_ID = "1471495923400970377";
const BB_DINGDONG_CHANNEL_ID = "1472134667946954894";

export type AssignableItem = {
  id: number;
  title: string;
  content: string | null;
  status: string;
  project_name: string;
  project_emoji: string | null;
  discord_channel_id: string | null;
  discord_thread_id: string | null;
};

function sendDiscordMessage(botToken: string, channelId: string, content: string, files: Array<{ name: string; data: Buffer; contentType?: string }> = []) {
  return new Promise((resolve, reject) => {
    if (files.length === 0) {
      const payload = JSON.stringify({ content });
      const req = https.request({
        hostname: "discord.com",
        path: `/api/v10/channels/${channelId}/messages`,
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
      return;
    }

    const boundary = `----FormBoundary${Date.now()}`;
    const parts: Array<string | Buffer> = [];
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ content })}\r\n`);
    files.forEach((file, index) => {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="files[${index}]"; filename="${file.name}"\r\nContent-Type: ${file.contentType || "image/jpeg"}\r\n\r\n`);
      parts.push(file.data);
      parts.push(`\r\n`);
    });
    parts.push(`--${boundary}--\r\n`);
    const body = Buffer.concat(parts.map((part) => typeof part === "string" ? Buffer.from(part) : part));

    const req = https.request({
      hostname: "discord.com",
      path: `/api/v10/channels/${channelId}/messages`,
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function randomPick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function extractFiles(item: AssignableItem) {
  const files: Array<{ name: string; data: Buffer; contentType?: string }> = [];
  if (!item.content) return files;

  for (const line of item.content.split("\n").filter((value) => value.trim().startsWith("/images/"))) {
    const filePath = path.join(IMAGES_DIR, line.trim().replace("/images/", ""));
    if (fs.existsSync(filePath)) {
      files.push({
        name: `${item.id}_${path.basename(filePath)}`,
        data: fs.readFileSync(filePath),
        contentType: "image/jpeg",
      });
    }
  }
  return files;
}

export async function getAssignableItems(itemIds: number[]) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("items")
    .select(`
      id, title, content, status,
      projects:project_id (name, emoji, discord_channel_id, discord_thread_id)
    `)
    .in("id", itemIds);

  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
      return {
        id: row.id,
        title: row.title,
        content: row.content,
        status: row.status,
        project_name: project?.name,
        project_emoji: project?.emoji ?? null,
        discord_channel_id: project?.discord_channel_id ?? null,
        discord_thread_id: project?.discord_thread_id ?? null,
      };
    })
    .filter((item): item is AssignableItem => !!item.project_name);
}

export async function assignItems(itemIds: number[]) {
  const items = (await getAssignableItems(itemIds)).filter((item) => item.status !== "review" && item.status !== "done");
  const grouped = new Map<string, { channelId: string | null; threadId: string | null; items: AssignableItem[] }>();

  for (const item of items) {
    const prev = grouped.get(item.project_name) ?? {
      channelId: item.discord_channel_id,
      threadId: item.discord_thread_id,
      items: [],
    };
    prev.items.push(item);
    grouped.set(item.project_name, prev);
  }

  const botToken = process.env.DISCORD_PANG_TOKEN || process.env.DISCORD_BOT_TOKEN;
  const assignedIds: number[] = [];

  if (botToken) {
    for (const [projectName, group] of grouped.entries()) {
      const targetChannel = group.threadId || group.channelId;
      if (!targetChannel) continue;

      const files: Array<{ name: string; data: Buffer; contentType?: string }> = [];
      const lines = [
        "📋 할일빵빵에서 형주가 시켰어",
        `프로젝트: ${projectName}`,
        "items:",
      ];

      for (const item of group.items) {
        lines.push(`- #${item.id} ${item.title}`);
        if (item.content) {
          const textLines = item.content
            .split("\n")
            .filter((line) => !line.trim().startsWith("/images/"))
            .map((line) => line.trim())
            .filter(Boolean);
          for (const line of textLines) lines.push(`  ${line}`);
        }
        const itemFiles = extractFiles(item);
        if (itemFiles.length > 0) {
          lines.push(`  📎 첨부파일 ${itemFiles.length}개`);
          files.push(...itemFiles);
        }
      }

      lines.push("");
      lines.push("할일빵빵에서 확인하고 작업해. 못 하겠으면 ❓, 형주가 할 거면 🙋 이모지로 리뷰 마킹해.");
      lines.push(`<@${BBANG_DISCORD_ID}>`);

      await sendDiscordMessage(botToken, targetChannel, lines.join("\n"), files);
      assignedIds.push(...group.items.map((item) => item.id));
    }
  }

  if (assignedIds.length > 0) {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("items")
      .update({ status: "in_progress" })
      .in("id", assignedIds);
    if (error) throw error;
  }

  return { assigned: assignedIds.length };
}

export async function assignSelfItems(itemIds: number[]) {
  const items = await getAssignableItems(itemIds);
  const pangToken = process.env.DISCORD_PANG_TOKEN;

  if (pangToken && items.length > 0) {
    const intros = [
      `📋 언니 <@${BBANG_DISCORD_ID}> 형주가 이거 안 해`,
      `📋 언니 <@${BBANG_DISCORD_ID}> 형주 또 미루고 있어`,
      `📋 <@${BBANG_DISCORD_ID}> 형주가 자기 할일 안 하고 우리한테만 시켜`,
      `📋 언니 <@${BBANG_DISCORD_ID}> 형주한테 좀 말해봐`,
      `📋 <@${BBANG_DISCORD_ID}> 형주 이거 해야 하는데 안 하고 있어`,
      `📋 언니 <@${BBANG_DISCORD_ID}> 형주가 또 딴짓해`,
      `📋 <@${BBANG_DISCORD_ID}> 형주 할일 쌓이고 있어...`,
      `📋 언니 <@${BBANG_DISCORD_ID}> 이거 형주가 하기로 한 건데`,
      `📋 <@${BBANG_DISCORD_ID}> 형주야 이거 직접 하기로 해놓고 뭐 해`,
      `📋 언니 <@${BBANG_DISCORD_ID}> 형주 또 게임하나봐`,
    ];

    const body = `${randomPick(intros)}\n\n${items.map((item) => `- **#${item.id}** ${item.title}`).join("\n")}`;
    await sendDiscordMessage(pangToken, BB_DINGDONG_CHANNEL_ID, body.trim());
  }

  return { assigned: items.length };
}
