#!/usr/bin/env node
/**
 * todo-to-archive.js — Move a completed project section from TODO.md to SQLite archive
 * Usage: node server/todo-to-archive.js --project "KIA 리뉴얼"
 *        node server/todo-to-archive.js --project "KIA 리뉴얼" --dry-run
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { execSync } = require("child_process");

// --- Config ---
const TODO_PATH = process.env.TODO_PATH || path.join(require("os").homedir(), ".openclaw/workspace/TODO.md");
const DB_PATH = process.env.CRON_DB_PATH || path.join(__dirname, "cron.db");
const TODAY = new Date().toISOString().slice(0, 10);

// --- Args ---
const args = process.argv.slice(2);
let projectName = null;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--project" && args[i + 1]) projectName = args[++i];
  if (args[i] === "--dry-run") dryRun = true;
}

if (!projectName) {
  console.error('Usage: node server/todo-to-archive.js --project "섹션 제목"');
  console.error('       node server/todo-to-archive.js --project "섹션 제목" --dry-run');
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
    // strip emoji prefix for matching
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
  console.error(`❌ Section not found: "${projectName}"`);
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
// Strip priority markers and completion dates
cleanName = cleanName.replace(/^!(?:1|2)\s+/, "").replace(/\s*\(완료:.*?\)/, "").replace(/\s*✅.*$/, "").trim();

// Parse categories and items
const categories = [];
const uncategorizedItems = [];
let currentCategory = null;

for (let i = 1; i < sectionLines.length; i++) {
  const line = sectionLines[i];

  // ### category
  const catMatch = line.match(/^###\s+(.+)$/);
  if (catMatch) {
    currentCategory = { name: catMatch[1].trim(), items: [] };
    categories.push(currentCategory);
    continue;
  }

  // - [x] or - [ ] item
  const itemMatch = line.match(/^\s*-\s+\[([ xX])\]\s+(?:★\s+)?(.+)$/);
  if (itemMatch) {
    const item = { title: itemMatch[2].trim(), content: null };
    // Look ahead for sub-items
    const subItems = [];
    let j = i + 1;
    while (j < sectionLines.length) {
      const subMatch = sectionLines[j].match(/^\s{2,}-\s+(.+)$/);
      if (subMatch) {
        subItems.push(subMatch[1].trim());
        j++;
      } else break;
    }
    if (subItems.length > 0) item.content = subItems.join("\n");

    if (currentCategory) {
      currentCategory.items.push(item);
    } else {
      uncategorizedItems.push(item);
    }
    continue;
  }
}

const totalItems = uncategorizedItems.length + categories.reduce((a, c) => a + c.items.length, 0);

console.log(`📦 Found: "${cleanName}" (${emoji || "no emoji"})`);
console.log(`   ${categories.length} categories, ${totalItems} items`);

if (totalItems === 0) {
  console.error("❌ No items found in this section. Aborting.");
  process.exit(1);
}

if (dryRun) {
  console.log("\n🔍 Dry run — no changes made.");
  console.log(`   Would archive ${totalItems} items to SQLite`);
  console.log(`   Would remove lines ${sectionStart + 1}-${sectionEnd} from TODO.md`);
  categories.forEach(c => console.log(`   📁 ${c.name}: ${c.items.length} items`));
  if (uncategorizedItems.length) console.log(`   📄 Uncategorized: ${uncategorizedItems.length} items`);
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

const insertCategory = db.prepare(`
  INSERT INTO categories (project_id, name, sort_order)
  VALUES (?, ?, ?)
`);

const insertItem = db.prepare(`
  INSERT INTO items (project_id, category_id, status, title, content, sort_order)
  VALUES (?, ?, 'archived', ?, ?, ?)
`);

const txn = db.transaction(() => {
  insertProject.run(cleanName, emoji);
  const project = getProject.get(cleanName);
  const projectId = project.id;

  let itemOrder = 0;

  // Uncategorized items first
  for (const item of uncategorizedItems) {
    insertItem.run(projectId, null, item.title, item.content, itemOrder++);
  }

  // Categories
  let catOrder = 0;
  for (const cat of categories) {
    const result = insertCategory.run(projectId, cat.name, catOrder++);
    const catId = result.lastInsertRowid;
    for (const item of cat.items) {
      insertItem.run(projectId, catId, item.title, item.content, itemOrder++);
    }
  }

  return itemOrder;
});

const inserted = txn();
console.log(`✅ ${inserted} items archived to SQLite`);

// --- Remove section from TODO.md ---
const newLines = [...lines.slice(0, sectionStart), ...lines.slice(sectionEnd)];
// Clean up triple+ blank lines
const cleaned = newLines.join("\n").replace(/\n{3,}/g, "\n\n");
fs.writeFileSync(TODO_PATH, cleaned);
console.log(`✅ Section removed from TODO.md (lines ${sectionStart + 1}-${sectionEnd})`);

// --- Git commit + push ---
try {
  const wsDir = path.dirname(TODO_PATH);
  execSync(`cd "${wsDir}" && git add TODO.md && git commit -m "🗄️ Archive: ${cleanName}" && git push origin main`, {
    stdio: "inherit",
    timeout: 30000,
  });
  console.log("✅ Git commit + push done");
} catch (e) {
  console.error("⚠️ Git push failed (archived to DB successfully):", e.message);
}

db.close();
