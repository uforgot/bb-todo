#!/usr/bin/env node
/**
 * TODO.md → SQLite 마이그레이션 스크립트
 * 
 * - 기존 DB 프로젝트/카테고리/아이템은 건드리지 않음
 * - TODO.md의 프로젝트를 DB에 upsert (이름 기준 매칭)
 * - 새 아이템은 status='todo', 기존 [x]는 status='done'
 * - ★ 마크는 priority=1
 * 
 * Usage: node migrate-todo.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DRY_RUN = process.argv.includes('--dry-run');
const TODO_PATH = path.join(process.env.HOME, '.openclaw/workspace/TODO.md');
const DB_PATH = path.join(__dirname, 'cron.db');

const db = Database(DB_PATH);

function parseTodoMd(content) {
  const lines = content.split('\n');
  const projects = [];
  let currentProject = null;
  let currentCategory = null;

  for (const line of lines) {
    // ## 프로젝트 헤더
    const projectMatch = line.match(/^## (.+)$/);
    if (projectMatch) {
      const raw = projectMatch[1].trim();
      // Parse priority (!1, !2)
      let priority = 99;
      let name = raw;
      const prioMatch = raw.match(/^!(\d)\s+(.+)$/);
      if (prioMatch) {
        priority = parseInt(prioMatch[1]);
        name = prioMatch[2];
      }
      // Parse emoji (first char if emoji)
      let emoji = null;
      const emojiMatch = name.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?\s*(.+)$/u);
      if (emojiMatch) {
        emoji = emojiMatch[1];
        name = emojiMatch[2].trim();
      }

      currentProject = { name, emoji, priority, categories: [], items: [] };
      currentCategory = null;
      projects.push(currentProject);
      continue;
    }

    if (!currentProject) continue;

    // ### 카테고리 헤더
    const catMatch = line.match(/^### (.+)$/);
    if (catMatch) {
      currentCategory = { name: catMatch[1].trim(), items: [] };
      currentProject.categories.push(currentCategory);
      continue;
    }

    // --- 구분선 → 카테고리 리셋
    if (line.match(/^---\s*$/)) {
      currentCategory = null;
      continue;
    }

    // - [ ] / - [x] 체크리스트 아이템
    const itemMatch = line.match(/^- \[([ x])\] (.+)$/);
    if (itemMatch) {
      const done = itemMatch[1] === 'x';
      let title = itemMatch[2].trim();
      let itemPriority = 0;

      // ★ prefix = high priority
      if (title.startsWith('★ ')) {
        itemPriority = 1;
        title = title.replace('★ ', '');
      }

      const item = {
        title,
        status: done ? 'done' : 'todo',
        priority: itemPriority,
        content: null
      };

      if (currentCategory) {
        currentCategory.items.push(item);
      } else {
        currentProject.items.push(item);
      }
      continue;
    }

    // 2-space indent sub-info → content of last item
    const subMatch = line.match(/^  - (.+)$/);
    if (subMatch) {
      const target = currentCategory ? currentCategory.items : currentProject.items;
      if (target.length > 0) {
        const lastItem = target[target.length - 1];
        if (lastItem.content) {
          lastItem.content += '\n' + subMatch[1].trim();
        } else {
          lastItem.content = subMatch[1].trim();
        }
      }
      continue;
    }
  }

  return projects;
}

function migrate(projects) {
  // Get existing projects by name
  const existingProjects = db.prepare("SELECT id, name FROM projects").all();
  const nameToId = {};
  existingProjects.forEach(p => { nameToId[p.name] = p.id; });

  const insertProject = db.prepare(
    "INSERT INTO projects (name, emoji, priority, sort_order, status) VALUES (?, ?, ?, ?, 'active')"
  );
  const updateProject = db.prepare(
    "UPDATE projects SET emoji=COALESCE(?, emoji), priority=?, status='active' WHERE id=?"
  );
  const insertCategory = db.prepare(
    "INSERT INTO categories (project_id, name, sort_order) VALUES (?, ?, ?)"
  );
  const insertItem = db.prepare(
    "INSERT INTO items (project_id, category_id, title, content, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const existingItems = db.prepare(
    "SELECT title, project_id, category_id FROM items WHERE status IN ('todo','in_progress','done')"
  ).all();
  const existingItemSet = new Set(existingItems.map(i => `${i.project_id}:${i.category_id || 0}:${i.title}`));

  let stats = { projects: 0, categories: 0, items: 0, skipped: 0 };

  const tx = db.transaction(() => {
    let sortOrder = existingProjects.length;

    for (const proj of projects) {
      let projectId;

      if (nameToId[proj.name]) {
        projectId = nameToId[proj.name];
        updateProject.run(proj.emoji, proj.priority, projectId);
        console.log(`  ♻️  Project "${proj.name}" (id=${projectId}) — updated`);
      } else {
        const result = insertProject.run(proj.name, proj.emoji, proj.priority, sortOrder++);
        projectId = result.lastInsertRowid;
        nameToId[proj.name] = projectId;
        stats.projects++;
        console.log(`  ✅ Project "${proj.name}" (id=${projectId}) — created`);
      }

      // Get existing categories for this project
      const existingCats = db.prepare("SELECT id, name FROM categories WHERE project_id=?").all(projectId);
      const catNameToId = {};
      existingCats.forEach(c => { catNameToId[c.name] = c.id; });

      // Uncategorized items
      let itemSort = 0;
      for (const item of proj.items) {
        const key = `${projectId}:0:${item.title}`;
        if (existingItemSet.has(key)) {
          stats.skipped++;
          continue;
        }
        insertItem.run(projectId, null, item.title, item.content, item.status, itemSort++);
        stats.items++;
      }

      // Categories + items
      let catSort = 0;
      for (const cat of proj.categories) {
        let catId;
        if (catNameToId[cat.name]) {
          catId = catNameToId[cat.name];
        } else {
          // Skip empty categories
          if (cat.items.length === 0) continue;
          const catResult = insertCategory.run(projectId, cat.name, catSort++);
          catId = catResult.lastInsertRowid;
          stats.categories++;
          console.log(`    📁 Category "${cat.name}" (id=${catId})`);
        }

        for (const item of cat.items) {
          const key = `${projectId}:${catId}:${item.title}`;
          if (existingItemSet.has(key)) {
            stats.skipped++;
            continue;
          }
          insertItem.run(projectId, catId, item.title, item.content, item.status, itemSort++);
          stats.items++;
        }
      }
    }
  });

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN — no changes written');
    // Still parse to show what would happen
    let sortOrder = existingProjects.length;
    for (const proj of projects) {
      if (nameToId[proj.name]) {
        console.log(`  ♻️  Project "${proj.name}" — would update`);
      } else {
        console.log(`  ✅ Project "${proj.name}" — would create`);
        stats.projects++;
      }
      for (const cat of proj.categories) {
        if (cat.items.length > 0) {
          stats.categories++;
          console.log(`    📁 Category "${cat.name}" (${cat.items.length} items)`);
        }
      }
      stats.items += proj.items.length + proj.categories.reduce((s, c) => s + c.items.length, 0);
    }
  } else {
    tx();
  }

  return stats;
}

// Main
console.log('📝 TODO.md → SQLite Migration');
console.log(`  Source: ${TODO_PATH}`);
console.log(`  DB: ${DB_PATH}`);
console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

const content = fs.readFileSync(TODO_PATH, 'utf8');
const projects = parseTodoMd(content);
console.log(`Parsed ${projects.length} projects from TODO.md\n`);

const stats = migrate(projects);
console.log(`\n📊 Results:`);
console.log(`  Projects created: ${stats.projects}`);
console.log(`  Categories created: ${stats.categories}`);
console.log(`  Items created: ${stats.items}`);
console.log(`  Items skipped (duplicate): ${stats.skipped}`);
