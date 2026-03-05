#!/usr/bin/env node
/**
 * todo-to-archive.js — Move completed items from TODO.md to SQLite archive
 * Usage:
 *   node server/todo-to-archive.js --project "KIA 리뉴얼"                    # 프로젝트 통째로
 *   node server/todo-to-archive.js --project "KIA 리뉴얼" --completed-only   # [x] 아이템만
 *   node server/todo-to-archive.js --project "KIA 리뉴얼" --completed-only --dry-run
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { execSync } = require("child_process");

// --- Config ---
const TODO_PATH = process.env.TODO_PATH || path.join(require("os").homedir(), ".openclaw/workspace/TODO.md");
const DB_PATH = process.env.CRON_DB_PATH || path.join(__dirname, "cron.db");

// --- Args ---
const args = process.argv.slice(2);
let projectName = null;
let dryRun = false;
let completedOnly = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--project" && args[i + 1]) projectName = args[++i];
  if (args[i] === "--dry-run") dryRun = true;
  if (args[i] === "--completed-only") completedOnly = true;
}

if (!projectName) {
  console.error('Usage: node server/todo-to-archive.js --project "프로젝트명"');
  console.error('       node server/todo-to-archive.js --project "프로젝트명" --completed-only');
  console.error('       node server/todo-to-archive.js --project "프로젝트명" --completed-only --dry-run');
  process.exit(1);
}

// --- Read TODO.md ---
if (!fs.existsSync(TODO_PATH)) {
  console.error(`❌ TODO.md not found: ${TODO_PATH}`);
  process.exit(1);
}

const content = fs.readFileSync(TODO_PATH, "utf-8");
const lines = content.split("\n");

// --- Find the target ## section ---
let sectionStart = -1;
let sectionEnd = lines.length;
let sectionLevel = 0;
let rawTitle = "";

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(#{1,2})\s+(?:!(?:1|2)\s+)?(.+)$/);
  if (m) {
    const level = m[1].length;
    const title = m[2].replace(/\s*✅.*$/, "").trim();
    const titleNoEmoji = title.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]\s*/u, "").trim();
    const searchNoEmoji = projectName.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]\s*/u, "").trim();

    if (sectionStart === -1 && (title.includes(projectName) || titleNoEmoji === searchNoEmoji)) {
      sectionStart = i;
      sectionLevel = level;
      rawTitle = m[2].trim();
    } else if (sectionStart !== -1 && level <= sectionLevel) {
      sectionEnd = i;
      break;
    }
  }
}

if (sectionStart === -1) {
  console.error(`❌ Project not found: "${projectName}"`);
  process.exit(1);
}

// --- Parse the section ---
const sectionLines = lines.slice(sectionStart, sectionEnd);

// Extract emoji from title
let emoji = null;
let cleanName = rawTitle;
const emojiMatch = rawTitle.match(/^([\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}])\s+(.+)$/u);
if (emojiMatch) {
  emoji = emojiMatch[1];
  cleanName = emojiMatch[2];
}
cleanName = cleanName.replace(/^!(?:1|2)\s+/, "").replace(/\s*\(완료:.*?\)/, "").replace(/\s*✅.*$/, "").trim();

// Parse categories and items with checked status + line tracking
const categories = [];
const uncategorizedItems = [];
let currentCategory = null;

for (let i = 1; i < sectionLines.length; i++) {
  const line = sectionLines[i];
  const absLine = sectionStart + i; // absolute line number in TODO.md

  const catMatch = line.match(/^###\s+(.+)$/);
  if (catMatch) {
    currentCategory = { name: catMatch[1].trim(), items: [], absLine };
    categories.push(currentCategory);
    continue;
  }

  const itemMatch = line.match(/^\s*-\s+\[([ xX])\]\s+(?:★\s+)?(.+)$/);
  if (itemMatch) {
    const checked = itemMatch[1].toLowerCase() === "x";
    const item = { title: itemMatch[2].trim(), content: null, checked, absLine };
    // Look ahead for sub-items
    const subItems = [];
    const subLines = [];
    let j = i + 1;
    while (j < sectionLines.length) {
      const subMatch = sectionLines[j].match(/^\s{2,}-\s+(.+)$/);
      if (subMatch) {
        subItems.push(subMatch[1].trim());
        subLines.push(sectionStart + j);
        j++;
      } else break;
    }
    if (subItems.length > 0) item.content = subItems.join("\n");
    item.subLines = subLines;

    if (currentCategory) {
      currentCategory.items.push(item);
    } else {
      uncategorizedItems.push(item);
    }
    continue;
  }
}

// --- Filter based on mode ---
let toArchive, toKeep;

if (completedOnly) {
  // Only archive checked items
  const filterItems = (items) => {
    const archive = items.filter(i => i.checked);
    const keep = items.filter(i => !i.checked);
    return { archive, keep };
  };

  const uncatFiltered = filterItems(uncategorizedItems);
  toArchive = {
    uncategorizedItems: uncatFiltered.archive,
    categories: categories.map(c => {
      const f = filterItems(c.items);
      return { ...c, items: f.archive, keepItems: f.keep };
    }).filter(c => c.items.length > 0),
  };
  toKeep = {
    uncategorizedItems: uncatFiltered.keep,
    categories: categories.map(c => {
      const f = filterItems(c.items);
      return { ...c, items: f.keep };
    }),
  };
} else {
  // Archive everything
  toArchive = { uncategorizedItems, categories };
  toKeep = { uncategorizedItems: [], categories: [] };
}

const archiveCount = toArchive.uncategorizedItems.length +
  toArchive.categories.reduce((a, c) => a + c.items.length, 0);

console.log(`📦 Found: "${cleanName}" (${emoji || "no emoji"})`);
if (completedOnly) {
  const totalItems = uncategorizedItems.length + categories.reduce((a, c) => a + c.items.length, 0);
  const keepCount = totalItems - archiveCount;
  console.log(`   ${archiveCount} completed → archive, ${keepCount} remaining`);
} else {
  console.log(`   ${categories.length} categories, ${archiveCount} items → archive (전체)`);
}

if (archiveCount === 0) {
  console.log("✅ No completed items to archive.");
  process.exit(0);
}

if (dryRun) {
  console.log("\n🔍 Dry run — no changes made.");
  console.log(`   Would archive ${archiveCount} items to SQLite`);
  toArchive.categories.forEach(c => console.log(`   📁 ${c.name}: ${c.items.length} items`));
  if (toArchive.uncategorizedItems.length) console.log(`   📄 Uncategorized: ${toArchive.uncategorizedItems.length} items`);
  if (completedOnly) {
    const remainCats = toKeep.categories.filter(c => c.items.length > 0);
    const remainItems = toKeep.uncategorizedItems.length + remainCats.reduce((a, c) => a + c.items.length, 0);
    console.log(`   📝 ${remainItems} items remain in TODO.md`);
  }
  process.exit(0);
}

// --- Insert into SQLite ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const insertProject = db.prepare(`
  INSERT OR IGNORE INTO projects (name, emoji, priority, sort_order)
  VALUES (?, ?, 99, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM projects))
`);

const getProject = db.prepare("SELECT id FROM projects WHERE name = ?");

const getCategory = db.prepare("SELECT id FROM categories WHERE project_id = ? AND name = ?");

const insertCategory = db.prepare(`
  INSERT INTO categories (project_id, name, sort_order)
  VALUES (?, ?, ?)
`);

const checkDuplicate = db.prepare("SELECT id FROM items WHERE project_id = ? AND title = ?");

const insertItem = db.prepare(`
  INSERT INTO items (project_id, category_id, status, title, content, sort_order)
  VALUES (?, ?, 'archived', ?, ?, ?)
`);

const txn = db.transaction(() => {
  insertProject.run(cleanName, emoji);
  const project = getProject.get(cleanName);
  const projectId = project.id;

  let inserted = 0;
  let skipped = 0;
  let itemOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE project_id = ?").pluck().get(projectId);

  // Uncategorized items
  for (const item of toArchive.uncategorizedItems) {
    const dup = checkDuplicate.get(projectId, item.title);
    if (dup) { skipped++; continue; }
    insertItem.run(projectId, null, item.title, item.content, ++itemOrder);
    inserted++;
  }

  // Categories
  let catOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) FROM categories WHERE project_id = ?").pluck().get(projectId);
  for (const cat of toArchive.categories) {
    let existing = getCategory.get(projectId, cat.name);
    let catId;
    if (existing) {
      catId = existing.id;
    } else {
      const result = insertCategory.run(projectId, cat.name, ++catOrder);
      catId = result.lastInsertRowid;
    }
    for (const item of cat.items) {
      const dup = checkDuplicate.get(projectId, item.title);
      if (dup) { skipped++; continue; }
      insertItem.run(projectId, catId, item.title, item.content, ++itemOrder);
      inserted++;
    }
  }

  return { inserted, skipped };
});

const { inserted, skipped } = txn();
console.log(`✅ ${inserted} items archived to SQLite${skipped > 0 ? ` (${skipped} duplicates skipped)` : ""}`);

// --- Update TODO.md ---
if (completedOnly) {
  // Collect line numbers to remove (archived items + their sub-items)
  const linesToRemove = new Set();

  for (const item of toArchive.uncategorizedItems) {
    linesToRemove.add(item.absLine);
    (item.subLines || []).forEach(l => linesToRemove.add(l));
  }

  for (const cat of toArchive.categories) {
    for (const item of cat.items) {
      linesToRemove.add(item.absLine);
      (item.subLines || []).forEach(l => linesToRemove.add(l));
    }
    // If ALL items in original category were checked, remove category header too
    const origCat = categories.find(c => c.name === cat.name);
    if (origCat && origCat.items.every(i => i.checked)) {
      linesToRemove.add(origCat.absLine);
    }
  }

  const newLines = lines.filter((_, i) => !linesToRemove.has(i));
  const cleaned = newLines.join("\n").replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(TODO_PATH, cleaned);
  console.log(`✅ ${linesToRemove.size} lines removed from TODO.md (project header preserved)`);
} else {
  // Remove entire section
  const newLines = [...lines.slice(0, sectionStart), ...lines.slice(sectionEnd)];
  const cleaned = newLines.join("\n").replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(TODO_PATH, cleaned);
  console.log(`✅ Project removed from TODO.md (lines ${sectionStart + 1}-${sectionEnd})`);
}

// --- Git commit + push ---
const mode = completedOnly ? "completed items" : "full project";
try {
  const wsDir = path.dirname(TODO_PATH);
  execSync(`cd "${wsDir}" && git pull --no-rebase origin main && git add TODO.md && git commit -m "🗄️ Archive (${mode}): ${cleanName}" && git push origin main`, {
    stdio: "inherit",
    timeout: 30000,
  });
  console.log("✅ Git commit + push done");
} catch (e) {
  console.error("⚠️ Git push failed (archived to DB successfully):", e.message);
}

db.close();
