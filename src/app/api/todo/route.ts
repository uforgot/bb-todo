import { NextResponse } from "next/server";
import {
  fetchTodoMd,
  updateTodoMd,
  ConflictError,
} from "@/lib/github";
import { applyToggles } from "@/lib/parser";

export async function GET() {
  try {
    const { content, sha } = await fetchTodoMd();
    return NextResponse.json({ content, sha });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch TODO.md";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface TogglePayload {
  sha: string;
  toggles: [number, boolean][]; // [lineIndex, checked][]
}

const MAX_RETRIES = 3;

export async function POST(request: Request) {
  try {
    const body: TogglePayload = await request.json();
    const { toggles } = body;
    let { sha } = body;

    if (!sha || !toggles || !Array.isArray(toggles) || toggles.length === 0) {
      return NextResponse.json(
        { error: "Invalid payload: sha and toggles required" },
        { status: 400 }
      );
    }

    const toggleMap = new Map<number, boolean>(toggles);

    // Retry loop with exponential backoff on conflict
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Fetch the current content to apply toggles on latest
        const current = attempt === 0
          ? await fetchTodoMd()
          : await fetchTodoMd(); // always fetch fresh on retry

        // On first attempt, verify SHA matches
        if (attempt === 0 && current.sha !== sha) {
          // SHA already stale, apply on latest
          sha = current.sha;
        } else if (attempt > 0) {
          sha = current.sha;
        }

        const updatedContent = applyToggles(current.content, toggleMap);

        // No changes needed
        if (updatedContent === current.content) {
          return NextResponse.json({ content: current.content, sha: current.sha });
        }

        const result = await updateTodoMd(updatedContent, sha);
        return NextResponse.json({ content: result.content, sha: result.sha });
      } catch (error) {
        if (error instanceof ConflictError && attempt < MAX_RETRIES - 1) {
          // Re-apply toggles on latest content, retry
          sha = error.latestSha;
          const delay = Math.pow(2, attempt) * 500;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }

    return NextResponse.json(
      { error: "Max retries exceeded due to conflicts" },
      { status: 409 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update TODO.md";
    const status = error instanceof ConflictError ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
