#!/usr/bin/env node
/**
 * Migration script: TODO-archive.md → SQLite (cron.db)
 *
 * Usage:
 *   node server/migrate-archive.js [path-to-TODO-archive.md]
 *
 * Default path: ~/.openclaw/workspace/TODO-archive.md
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const archivePath = process.argv[2] || path.join(require("os").homedir(), ".openclaw/workspace/TODO-archive.md");
const DB_PATH = process.env.CRON_DB_PATH || path.join(__dirname, "cron.db");

if (!fs.existsSync(archivePath)) {
  console.error(`❌ File not found: ${archivePath}`);
  process.exit(1);
}

// --- Emoji detection (first character if it's an emoji) ---
function extractEmoji(title) {
  // Match leading emoji (including compound emoji with ZWJ/variation selectors)
  const emojiMatch = title.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(\u200D(\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/u);
  if (emojiMatch) {
    const emoji = emojiMatch[0];
    const name = title.slice(emoji.length).trim();
    return { emoji, name };
  }
  return { emoji: null, name: title };
}

// --- Strip "(완료: ...)" from project name ---
function stripCompletionDate(title) {
  return title.replace(/\s*\(완료:\s*[\d\-/.]+\)\s*$/, "").trim();
}

// --- Parse TODO-archive.md ---
function parseArchive(content) {
  const lines = content.split("\n");
  const projects = [];
  let currentProject = null;
  let currentCategory = null;
  let currentItem = null;
  let projectOrder = 0;
  let categoryOrder = 0;
  let itemOrder = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ## Project heading
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      let rawTitle = h2Match[1].trim();
      rawTitle = stripCompletionDate(rawTitle);
      const { emoji, name } = extractEmoji(rawTitle);

      currentProject = {
        name,
        emoji,
        priority: 99,
        sort_order: projectOrder++,
        categories: [],
        items: [],
      };
      currentCategory = null;
      currentItem = null;
      categoryOrder = 0;
      itemOrder = 0;
      projects.push(currentProject);
      continue;
    }

    // ### Category heading
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match && currentProject) {
      currentCategory = {
        name: h3Match[1].trim(),
        sort_order: categoryOrder++,
        items: [],
      };
      currentItem = null;
      itemOrder = 0;
      currentProject.categories.push(currentCategory);
      continue;
    }

    // - [x] or - [ ] item (top-level, not indented)
    const itemMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (itemMatch && currentProject) {
      currentItem = {
        title: itemMatch[2].trim(),
        status: "archived",
        content: null,
        sort_order: itemOrder++,
      };

      if (currentCategory) {
        currentCategory.items.push(currentItem);
      } else {
        currentProject.items.push(currentItem);
      }
      continue;
    }

    // Sub-item (2+ space indented "- text") → concatenate into parent item's content
    const subMatch = line.match(/^\s{2,}-\s+(.+)$/);
    if (subMatch && currentItem) {
      if (currentItem.content === null) {
        currentItem.content = subMatch[1].trim();
      } else {
        currentItem.content += "\n" + subMatch[1].trim();
      }
      continue;
    }

    // Any non-matching line resets currentItem (so sub-items don't attach to wrong parent)
    if (line.trim() === "") {
      currentItem = null;
    }
  }

  return projects;
}

// --- Insert into SQLite ---
const content = fs.readFileSync(archivePath, "utf-8");
const projects = parseArchive(content);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Ensure tables exist
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    emoji TEXT,
    priority INTEGER NOT NULL DEFAULT 99,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    category_id INTEGER REFERENCES categories(id),
    status TEXT NOT NULL DEFAULT 'todo'
      CHECK (status IN ('todo', 'in_progress', 'done', 'archived')),
    title TEXT NOT NULL,
    content TEXT,
    sort_order INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const insertProject = db.prepare(
  `INSERT INTO projects (name, emoji, priority, sort_order) VALUES (?, ?, ?, ?)`
);
const insertCategory = db.prepare(
  `INSERT INTO categories (project_id, name, sort_order) VALUES (?, ?, ?)`
);
const insertItem = db.prepare(
  `INSERT INTO items (project_id, category_id, status, title, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
);

let totalProjects = 0;
let totalCategories = 0;
let totalItems = 0;

const migrate = db.transaction(() => {
  for (const proj of projects) {
    const projResult = insertProject.run(proj.name, proj.emoji, proj.priority, proj.sort_order);
    const projectId = projResult.lastInsertRowid;
    totalProjects++;

    // Insert uncategorized items
    for (const item of proj.items) {
      insertItem.run(projectId, null, item.status, item.title, item.content, item.sort_order);
      totalItems++;
    }

    // Insert categories + their items
    for (const cat of proj.categories) {
      const catResult = insertCategory.run(projectId, cat.name, cat.sort_order);
      const categoryId = catResult.lastInsertRowid;
      totalCategories++;

      for (const item of cat.items) {
        insertItem.run(projectId, categoryId, item.status, item.title, item.content, item.sort_order);
        totalItems++;
      }
    }
  }
});

migrate();
db.close();

console.log(`✅ Migration complete!`);
console.log(`   ${totalProjects} projects, ${totalCategories} categories, ${totalItems} items imported`);
console.log(`   DB: ${DB_PATH}`);
