import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.CRON_DB_PATH || path.join(process.cwd(), "server", "cron.db");
const db = new Database(DB_PATH, { readonly: false });

type DiscordChannelRow = {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
};

export function listDiscordChannels() {
  const rows = db.prepare("SELECT * FROM discord_channels ORDER BY name").all() as DiscordChannelRow[];
  return rows
    .filter((row) => row.type === "channel")
    .map((channel) => ({
      ...channel,
      threads: rows.filter((thread) => thread.parent_id === channel.id),
    }));
}
