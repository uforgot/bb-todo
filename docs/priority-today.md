# Priority & Today Feature Spec

## Overview

Two new features for 할일빵빵:
1. **Priority tags** (!1/!2) — visual urgency indicators
2. **Today view** (★) — "오늘 할 일" focus mode, inspired by Things

## Markdown Syntax

```markdown
- [ ] !1 긴급한 할일           → 빨간 보더
- [ ] !2 중요한 할일           → 주황 보더
- [ ] ★ 오늘 할 일             → "오늘" 섹션에 표시
- [ ] !1 ★ 긴급 + 오늘 할 일   → 빨간 보더 + "오늘" 표시
- [ ] 일반 할일                → 기본 (보더 없음)
```

**Token order:** `!1` → `★` → content (priority first, then today tag)

## Priority System

| Tag | Meaning | Visual |
|-----|---------|--------|
| `!1` | 긴급 | Left border 4px red (`#EF4444`) |
| `!2` | 중요 | Left border 4px orange (`#F97316`) |
| (none) | 일반 | No border |

- Priority is **per-item**, not per-section
- Completed items: priority indicator hidden
- No icon/emoji in UI — **color-only** (user is not colorblind)

## Today View (★)

### Concept
- Inspired by Things "Today" — morning focus list
- ★ tag marks items as "doing today" regardless of priority
- Top pinned section shows all ★ items as a **virtual view** (reference, not copy)

### UI Structure

```
┌─────────────────────────────┐
│ ⭐ 오늘                      │  ← Always-visible top section
│  ☐ KIA 피그마 피드백 정리     │     (aggregated from all sections)
│  ☐ 박성우 전화               │
└─────────────────────────────┘

┌ 🚗 KIA Worldwide ──────────┐  ← Existing accordion
│  🔴│ ☐ 피그마 피드백 정리    │     (★ items slightly dimmed here)
│    │ ☐ GNB 그림자 가이드     │
└─────────────────────────────┘
```

### Behavior
- ★ items appear in **both** "오늘" section and original section
- Original section: ★ item shown with slight dim (opacity or subtle indicator)
- Check in either location → marks complete in both (same item)
- Remove ★ → disappears from "오늘" section
- "오늘" section hidden when no ★ items exist

### Toggle Mechanism
- App: tap/long-press → toggle ★
- GitHub write: add/remove `★` character in the line

## Agent Rules

```
Agents (빵빵, 팡팡) MUST NOT add ★ or !1/!2 tags.
Only 형주 sets priority/today tags via the app.
Agents add items as plain: `- [ ] task description`
```

→ Add to AGENTS.md TODO.md Depth Structure section.

## Parser Changes

- Regex: `/^- \[([ x])\] (?:(!1|!2) )?(?:(★) )?(.+)$/`
- Extract: `completed`, `priority`, `today`, `content`
- Minimal change to existing parser

## GitHub API

- Priority/today toggle: modify single line → commit
- Debounce: 2s after last change
- No file structure change — same TODO.md

## Implementation Order

1. Parser: add priority + today regex
2. UI: accordion left-border for priority
3. UI: "오늘" top section (virtual view)
4. Interaction: toggle priority (long-press menu)
5. Interaction: toggle ★ (tap or menu)
6. GitHub write: single-line update on toggle

## Rejected Alternatives

- **Drag sort**: Overkill for single-user app. MD parsing + touch gesture complexity not worth it.
- **↑↓ buttons**: Conflicts with accordion toggle touch targets.
- **Section-based "오늘"** (팡팡 proposal): Items duplicated between sections, maintenance burden. Virtual view avoids this.
- **P0/P1/P2/P3 labels**: 4 levels too many. 3 levels (긴급/중요/일반) sufficient.
- **DB**: Breaks the single-file simplicity that makes 할일빵빵 work.
