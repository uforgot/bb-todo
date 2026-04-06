#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const verbose = args.has('--verbose');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'server', 'cron.db');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOG_DIR = path.join(__dirname, '..', 'tmp');
const LOG_PATH = path.join(LOG_DIR, `sqlite-to-supabase-${Date.now()}.log`);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`SQLite DB not found: ${SQLITE_PATH}`);
  process.exit(1);
}

fs.mkdirSync(LOG_DIR, { recursive: true });
const log = (message, data) => {
  const line = `[${new Date().toISOString()}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`;
  fs.appendFileSync(LOG_PATH, `${line}\n`);
  console.log(line);
};

const db = new Database(SQLITE_PATH, { readonly: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function upsert(table, rows, onConflict) {
  if (!rows.length) return;
  if (dryRun) {
    log(`DRY RUN upsert ${table}`, { count: rows.length, first: rows[0] });
    return;
  }
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
  log(`upserted ${table}`, { count: rows.length });
}

function readRows() {
  const projects = db.prepare(`
    select id, name, emoji, priority, sort_order, coalesce(status, 'active') as status,
           color, discord_channel_id, discord_thread_id, created_at
    from projects
  `).all();

  const categories = db.prepare(`
    select id, project_id, name, sort_order, created_at
    from categories
  `).all();

  const items = db.prepare(`
    select id, project_id, category_id, status, title, content, sort_order,
           coalesce(is_today, 0) as is_today,
           coalesce(review_count, 0) as review_count,
           review_emoji, owner, created_at, updated_at
    from items
  `).all();

  const validCategoryIds = new Set(categories.map((row) => row.id));
  const sanitizedItems = [];
  let brokenCategoryRefs = 0;

  for (const row of items) {
    if (row.category_id != null && !validCategoryIds.has(row.category_id)) {
      brokenCategoryRefs += 1;
      log('broken category ref -> null', {
        item_id: row.id,
        project_id: row.project_id,
        category_id: row.category_id,
        title: row.title,
      });
      sanitizedItems.push({ ...row, category_id: null });
      continue;
    }
    sanitizedItems.push(row);
  }

  log('sqlite sanitization summary', { brokenCategoryRefs });
  return { projects, categories, items: sanitizedItems };
}

async function verifyCounts(expected) {
  const [projectsRes, categoriesRes, itemsRes] = await Promise.all([
    supabase.from('projects').select('id', { count: 'exact', head: true }),
    supabase.from('categories').select('id', { count: 'exact', head: true }),
    supabase.from('items').select('id', { count: 'exact', head: true }),
  ]);

  const actual = {
    projects: projectsRes.count ?? 0,
    categories: categoriesRes.count ?? 0,
    items: itemsRes.count ?? 0,
  };

  log('verify counts', { expected, actual });
}

async function main() {
  const { projects, categories, items } = readRows();
  const expected = {
    projects: projects.length,
    categories: categories.length,
    items: items.length,
  };

  log('starting migration', { SQLITE_PATH, dryRun, expected });

  await upsert('projects', projects.map((row) => ({
    ...row,
    created_at: row.created_at || new Date().toISOString(),
  })), 'id');

  await upsert('categories', categories.map((row) => ({
    ...row,
    created_at: row.created_at || new Date().toISOString(),
  })), 'id');

  await upsert('items', items.map((row) => ({
    ...row,
    is_today: !!row.is_today,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || row.created_at || new Date().toISOString(),
  })), 'id');

  if (!dryRun || verbose) {
    await verifyCounts(expected);
  }

  log('migration complete', expected);
}

main().catch((error) => {
  log('migration failed', { message: error.message });
  console.error(error);
  process.exit(1);
});
