#!/usr/bin/env node
/**
 * Draft migration script: SQLite -> Supabase
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * Optional:
 * - SQLITE_PATH
 *
 * Note:
 * - Preserves existing numeric ids by inserting bigint ids directly.
 * - Upserts in dependency order: projects -> categories -> items.
 */

const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'server', 'cron.db');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = new Database(SQLITE_PATH, { readonly: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function upsert(table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

async function main() {
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

  await upsert('projects', projects.map(row => ({
    ...row,
    created_at: row.created_at || new Date().toISOString(),
  })), 'id');

  await upsert('categories', categories.map(row => ({
    ...row,
    created_at: row.created_at || new Date().toISOString(),
  })), 'id');

  await upsert('items', items.map(row => ({
    ...row,
    is_today: !!row.is_today,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || row.created_at || new Date().toISOString(),
  })), 'id');

  console.log(`Migrated ${projects.length} projects, ${categories.length} categories, ${items.length} items.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
