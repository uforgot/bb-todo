import { NextResponse } from "next/server";
import { listDiscordChannels } from "../../../../lib/discord-channel-service";

export async function POST() {
  try {
    const data = listDiscordChannels();
    const channelCount = data.length;
    const threadCount = data.reduce((sum, channel) => sum + (channel.threads?.length ?? 0), 0);
    return NextResponse.json({ synced: true, channels: channelCount, threads: threadCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Discord channels";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
