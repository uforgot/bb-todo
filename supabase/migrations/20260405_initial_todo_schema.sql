-- bb-todo initial Supabase schema draft

create table if not exists projects (
  id bigint primary key,
  name text not null unique,
  emoji text,
  priority integer not null default 99,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  color text,
  discord_channel_id text,
  discord_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id bigint primary key,
  project_id bigint not null references projects(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, name)
);

create table if not exists items (
  id bigint primary key,
  project_id bigint not null references projects(id) on delete cascade,
  category_id bigint references categories(id) on delete set null,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'review', 'archived')),
  title text not null,
  content text,
  sort_order integer not null default 0,
  is_today boolean not null default false,
  review_count integer not null default 0,
  review_emoji text,
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_status_sort on projects(status, priority, sort_order, id);
create index if not exists idx_categories_project_sort on categories(project_id, sort_order, id);
create index if not exists idx_items_project_status_sort on items(project_id, status, sort_order, id);
create index if not exists idx_items_category_sort on items(category_id, sort_order, id);
create index if not exists idx_items_owner on items(owner);
create index if not exists idx_items_today on items(is_today) where is_today = true;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_set_updated_at
before update on projects
for each row execute function set_updated_at();

create trigger categories_set_updated_at
before update on categories
for each row execute function set_updated_at();

create trigger items_set_updated_at
before update on items
for each row execute function set_updated_at();

-- optional view for active board
create or replace view active_items as
select * from items where status in ('todo', 'in_progress', 'done', 'review');

create or replace view archived_items as
select * from items where status = 'archived';
