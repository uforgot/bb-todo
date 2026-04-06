export interface TodoItemDTO {
  id: number;
  title: string;
  content: string | null;
  status: string;
  is_today: boolean;
  review_count: number;
  review_emoji: string | null;
  owner: string | null;
  category_id?: number | null;
}

export interface TodoCategoryDTO {
  id: number;
  name: string;
  items: TodoItemDTO[];
}

export interface TodoProjectDTO {
  id: number;
  emoji: string | null;
  name: string;
  priority: number;
  color: string | null;
  discord_channel_id: string | null;
  discord_thread_id: string | null;
  items: TodoItemDTO[];
  categories: TodoCategoryDTO[];
}

export interface ArchiveItemDTO {
  id: number;
  title: string;
  status: string;
  content: string | null;
  archivedAt: string | null;
}

export interface ArchiveCategoryDTO {
  id: number;
  name: string;
  items: ArchiveItemDTO[];
}

export interface ArchiveProjectDTO {
  id: number;
  name: string;
  emoji: string | null;
  priority: number;
  categories: ArchiveCategoryDTO[];
  items: ArchiveItemDTO[];
}

export interface ArchiveResponseDTO {
  projects: ArchiveProjectDTO[];
}
