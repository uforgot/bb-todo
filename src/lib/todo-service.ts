import { getSupabaseAdmin } from "./supabase-admin";
import type {
  ArchiveProjectDTO,
  ArchiveResponseDTO,
  TodoItemDTO,
  TodoProjectDTO,
} from "./todo-types";

type ProjectRow = {
  id: number;
  emoji: string | null;
  name: string;
  priority: number;
  color: string | null;
  discord_channel_id: string | null;
  discord_thread_id: string | null;
};

type CategoryRow = {
  id: number;
  project_id: number;
  name: string;
};

type ItemRow = {
  id: number;
  project_id: number;
  category_id: number | null;
  title: string;
  content: string | null;
  status: string;
  is_today: boolean;
  review_count: number | null;
  review_emoji: string | null;
  owner: string | null;
  updated_at?: string | null;
};

function mapItem(row: ItemRow): TodoItemDTO {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    is_today: !!row.is_today,
    review_count: row.review_count ?? 0,
    review_emoji: row.review_emoji ?? null,
    owner: row.owner ?? null,
    category_id: row.category_id ?? null,
  };
}

function buildProjectsTree(projects: ProjectRow[], categories: CategoryRow[], items: ItemRow[]): TodoProjectDTO[] {
  return projects.map((project) => {
    const projectCategories = categories.filter((category) => category.project_id === project.id);
    const projectItems = items.filter((item) => item.project_id === project.id);

    return {
      ...project,
      items: projectItems.filter((item) => item.category_id == null).map(mapItem),
      categories: projectCategories.map((category) => ({
        id: category.id,
        name: category.name,
        items: projectItems.filter((item) => item.category_id === category.id).map(mapItem),
      })),
    };
  });
}

export async function listActiveProjectsTree(): Promise<TodoProjectDTO[]> {
  const supabaseAdmin = getSupabaseAdmin();
  const [{ data: projects, error: projectsError }, { data: categories, error: categoriesError }, { data: items, error: itemsError }] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, emoji, name, priority, color, discord_channel_id, discord_thread_id")
      .eq("status", "active")
      .order("priority", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabaseAdmin
      .from("categories")
      .select("id, project_id, name")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabaseAdmin
      .from("items")
      .select("id, project_id, category_id, title, content, status, is_today, review_count, review_emoji, owner")
      .in("status", ["todo", "in_progress", "done", "review"])
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (projectsError) throw projectsError;
  if (categoriesError) throw categoriesError;
  if (itemsError) throw itemsError;

  return buildProjectsTree((projects ?? []) as ProjectRow[], (categories ?? []) as CategoryRow[], (items ?? []) as ItemRow[]);
}

export async function listArchivedProjectsTree(): Promise<ArchiveResponseDTO> {
  const supabaseAdmin = getSupabaseAdmin();
  const [{ data: projects, error: projectsError }, { data: categories, error: categoriesError }, { data: items, error: itemsError }] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id, name, emoji, priority")
      .order("id", { ascending: false }),
    supabaseAdmin
      .from("categories")
      .select("id, project_id, name")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabaseAdmin
      .from("items")
      .select("id, project_id, category_id, title, status, content, updated_at")
      .eq("status", "archived")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (projectsError) throw projectsError;
  if (categoriesError) throw categoriesError;
  if (itemsError) throw itemsError;

  const result: ArchiveProjectDTO[] = ((projects ?? []) as Array<{ id: number; name: string; emoji: string | null; priority: number }>).map((project) => {
    const projectCategories = ((categories ?? []) as CategoryRow[]).filter((category) => category.project_id === project.id);
    const projectItems = ((items ?? []) as ItemRow[]).filter((item) => item.project_id === project.id);

    return {
      ...project,
      categories: projectCategories.map((category) => ({
        id: category.id,
        name: category.name,
        items: projectItems
          .filter((item) => item.category_id === category.id)
          .map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            content: item.content,
            archivedAt: item.updated_at ?? null,
          })),
      })),
      items: projectItems
        .filter((item) => item.category_id == null)
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          content: item.content,
          archivedAt: item.updated_at ?? null,
        })),
    };
  }).filter((project) => project.items.length > 0 || project.categories.some((category) => category.items.length > 0));

  return { projects: result };
}

export async function updateItem(id: number, updates: Record<string, unknown>) {
  const supabaseAdmin = getSupabaseAdmin();
  const payload: Record<string, unknown> = {};
  for (const key of ["title", "content", "status", "is_today", "category_id", "project_id", "review_emoji", "owner"]) {
    if (updates[key] !== undefined) payload[key] = updates[key];
  }

  const nextStatus = typeof updates.status === "string" ? updates.status : undefined;

  const { data: current, error: currentError } = await supabaseAdmin
    .from("items")
    .select("id, project_id, status, review_count")
    .eq("id", id)
    .single();

  if (currentError) throw currentError;

  if (nextStatus === "review" && current.status !== "review") {
    payload.review_count = (current.review_count ?? 0) + 1;
  }

  if (nextStatus === "done") {
    payload.updated_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("items")
    .update(payload)
    .eq("id", id)
    .select("id, project_id, category_id, title, content, status, is_today, review_count, review_emoji, owner, updated_at")
    .single();

  if (error) throw error;
  return data;
}

export async function createItem(projectId: number, input: {
  title: string;
  content?: string | null;
  category_id?: number | null;
  is_today?: boolean;
  owner?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("items")
    .insert({
      project_id: projectId,
      category_id: input.category_id ?? null,
      title: input.title,
      content: input.content ?? null,
      is_today: !!input.is_today,
      owner: input.owner ?? null,
    })
    .select("id, title, content, status, is_today, project_id, category_id")
    .single();

  if (error) throw error;
  return data;
}

export async function createCategory(projectId: number, input: { name: string }) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("categories")
    .insert({
      project_id: projectId,
      name: input.name,
    })
    .select("id, name, project_id")
    .single();

  if (error) throw error;
  return data;
}

export async function updateProject(id: number, updates: Record<string, unknown>) {
  const supabaseAdmin = getSupabaseAdmin();
  const payload: Record<string, unknown> = {};
  for (const key of ["emoji", "name", "priority", "status", "color", "discord_channel_id", "discord_thread_id"]) {
    if (updates[key] !== undefined) payload[key] = updates[key];
  }

  if (Object.keys(payload).length === 0) {
    throw new Error("no fields to update");
  }

  const { data, error } = await supabaseAdmin
    .from("projects")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function reorderProjects(order: number[]) {
  const supabaseAdmin = getSupabaseAdmin();
  for (const [index, id] of order.entries()) {
    const { error } = await supabaseAdmin.from("projects").update({ sort_order: index }).eq("id", id);
    if (error) throw error;
  }
  return { ok: true };
}

export async function deleteProject(id: number) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.from("projects").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

export async function updateItemOwner(id: number, owner: string | null) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("items")
    .update({ owner })
    .eq("id", id)
    .select("id, project_id, category_id, title, content, status, is_today, review_count, review_emoji, owner, updated_at")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteItem(id: number) {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.from("items").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

export async function untodayAll(doneOnly = false) {
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin.from("items").update({ is_today: false }).eq("is_today", true);
  if (doneOnly) query = query.eq("status", "done");
  const { data, error } = await query.select("id");
  if (error) throw error;
  return { cleared: data?.length ?? 0 };
}

export async function clearDone(projectId: number) {
  const supabaseAdmin = getSupabaseAdmin();
  const { count, error: countError } = await supabaseAdmin
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "done");

  if (countError) throw countError;

  const { error } = await supabaseAdmin
    .from("items")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("status", "done");

  if (error) throw error;

  const { data: categories, error: categoriesError } = await supabaseAdmin
    .from("categories")
    .select("id")
    .eq("project_id", projectId);

  if (categoriesError) throw categoriesError;

  const categoryIds = (categories ?? []).map((category) => category.id);
  if (categoryIds.length > 0) {
    const { data: usedCategories, error: usedError } = await supabaseAdmin
      .from("items")
      .select("category_id")
      .eq("project_id", projectId)
      .not("category_id", "is", null);

    if (usedError) throw usedError;

    const usedSet = new Set((usedCategories ?? []).map((row) => row.category_id).filter((value): value is number => value != null));
    const deleteIds = categoryIds.filter((categoryId) => !usedSet.has(categoryId));

    if (deleteIds.length > 0) {
      const { error: deleteError } = await supabaseAdmin.from("categories").delete().in("id", deleteIds);
      if (deleteError) throw deleteError;
    }
  }

  return { cleared: count ?? 0 };
}
