# Priority & Today Feature Spec

## Overview

Two new features for 할일빵빵:
1. **Section priority** (!1/!2) — visual urgency on accordion cards (## level)
2. **Today view** (★) — "오늘 할 일" focus mode on individual items, inspired by Things

## Markdown Syntax

### Section Priority (## headings only)
```markdown
## !1 🚗 KIA 리뉴얼          → 아코디언 카드에 빨간 좌측 보더
## !2 ✍️ 글쓰기               → 아코디언 카드에 주황 좌측 보더
## 🖼️ kia_image_manager      → 기본 (보더 없음)
```

### Today Tag (individual items only)
```markdown
- [ ] ★ Header 피드백 적용    → "오늘" 섹션에 표시, 주황색 텍스트
- [ ] Footer 피드백 적용      → 일반
```

**!1/!2 is for sections. ★ is for items. They do NOT mix.**

## Section Priority System

| Tag | Meaning | Visual |
|-----|---------|--------|
| `!1` | 긴급 | Card left border 4px red (`#EF4444`) |
| `!2` | 중요 | Card left border 4px orange (`#F97316`) |
| (none) | 일반 | No border |

- Priority is **per-section** (## heading), NOT per-item
- Applied to the accordion Card component
- Parser: extract from heading title, strip from display text

## Today View (★)

### Concept
- Inspired by Things "Today" — morning focus list
- ★ tag on individual `- [ ]` items marks them as "doing today"
- Top pinned section shows all ★ items as a **virtual view** (reference, not copy)

### UI Structure

```
┌─────────────────────────────┐
│ ⭐ 오늘                      │  ← Always-visible top section
│  KIA 리뉴얼                  │     (source section label)
│  ☐ Header 피드백 적용        │     (orange text)
│  KIA 리뉴얼                  │
│  ☐ MA 컨텐츠 회의            │
└─────────────────────────────┘

┌ 🚗 KIA 리뉴얼 ──────────────┐  ← Red border (if !1)
│  ☐ Header 피드백 적용        │     (dimmed — already in 오늘)
│  ☐ GNB 그림자 가이드         │
└──────────────────────────────┘
```

### Visual
- ★ items: text color orange (`#F97316`), no border/icon
- In "오늘" section: no priority border, just orange text + section label
- In original section: ★ items shown with `opacity-70` (dimmed)

### Behavior
- ★ items appear in **both** "오늘" section and original section
- Check in either location → marks complete in both (same line number)
- Remove ★ → disappears from "오늘" section
- "오늘" section hidden when no ★ items exist

## Agent Rules

```
Agents (빵빵, 팡팡) MUST NOT add ★ or !1/!2 tags.
Only 형주 sets priority/today tags via the app or manual edit.
Agents add items as plain: `- [ ] task description`
Agents add sections as plain: `## Section Title`
```

## Parser Changes

### Section priority
- Heading regex: `/^(#{1,6})\s+(?:(!1|!2)\s+)?(.+)$/`
- Extract priority from heading, strip from title
- Add `priority: '!1' | '!2' | null` to TodoSection interface

### Today tag
- Checkbox regex: `/^[\s]*-\s+\[([ xX])\]\s+(?:(★)\s+)?(.+)$/`
- Extract ★ from item, strip from text
- Add `today: boolean` to TodoItem interface

## Implementation Order

1. Parser: section priority + today regex
2. UI: Card left-border for section priority (!1/!2)
3. UI: ★ item orange text color
4. UI: "오늘" top section (virtual view, dimmed originals)
5. (Future) Interaction: toggle ★ in app
6. (Future) Interaction: set section priority in app

## Rejected Alternatives

- **Item-level priority (!1/!2 on checklist items)**: Confusing — mixes section urgency with item urgency. Section-level is cleaner.
- **Drag sort**: Overkill for single-user app.
- **↑↓ buttons**: Conflicts with accordion toggle touch targets.
- **Section-based "오늘"** (move items to ## 오늘): Items duplicated, maintenance burden.
- **P0/P1/P2/P3 labels**: 4 levels too many.
- **DB**: Breaks single-file simplicity.
- **Emoji icons for priority**: User is not colorblind, color-only is cleaner.
