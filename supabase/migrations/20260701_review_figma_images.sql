create table if not exists public.review_figma_images (
  id text primary key,
  project_id text not null,
  source text not null default 'supabase',
  target_key text not null,
  target jsonb not null,
  target_type text not null check (target_type in ('route', 'figma-node')),
  page_url text,
  viewport_label text,
  viewport_width integer,
  viewport_height integer,
  viewport_scope text check (
    viewport_scope is null
    or viewport_scope in ('mobile', 'tablet', 'desktop', 'wide')
  ),
  slot text,
  figma_url text not null,
  file_key text not null,
  node_id text not null,
  image_url text not null,
  image_format text not null check (image_format in ('webp', 'png', 'jpg')),
  mime_type text not null,
  storage_key text not null,
  label text,
  sort_order integer not null default 0,
  width integer,
  height integer,
  byte_size integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists review_figma_images_target_order_idx
  on public.review_figma_images (
    project_id,
    source,
    target_key,
    sort_order,
    created_at
  );

create index if not exists review_figma_images_project_updated_idx
  on public.review_figma_images (project_id, source, updated_at desc);

alter table public.review_figma_images enable row level security;

drop policy if exists review_figma_images_service_role_all on public.review_figma_images;
create policy review_figma_images_service_role_all
  on public.review_figma_images
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on public.review_figma_images to service_role;
