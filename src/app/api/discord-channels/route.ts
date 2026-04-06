import { NextResponse } from "next/server";
import { listDiscordChannels } from "../../../lib/discord-channel-service";

export async function GET() {
  try {
    const data = listDiscordChannels();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Discord channels";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
