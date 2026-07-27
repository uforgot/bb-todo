export type TodayQueueItemStatus = "todo" | "in_progress" | "review";

export interface TodayQueueCounts {
  todo: number;
  in_progress: number;
  review: number;
  total: number;
}

export interface TodayQueueItem {
  id: number;
  title: string;
  content: string | null;
  status: TodayQueueItemStatus;
  is_today: boolean;
  review_count: number;
  review_emoji: string | null;
  owner: string | null;
  dispatch_nonce: string | null;
  dispatch_message_id: string | null;
  dispatch_channel_id: string | null;
  dispatch_message_url: string | null;
  dispatch_target_bot_key: string | null;
  dispatch_target_bot_user_id: string | null;
  dispatch_started_at: string | null;
  dispatch_attempt_count: number;
  dispatch_last_error: string | null;
  today_queue_order: number | null;
  project_id: number;
  project_name: string | null;
  project_emoji: string | null;
  category_id: number | null;
  category_name: string | null;
  project_sort_order: number | null;
  category_sort_order: number | null;
  default_ai_bot_key: string;
  has_discord_target: boolean;
}

export interface TodayQueueProjectStatus {
  project_id: number;
  project_name: string | null;
  project_emoji: string | null;
  project_sort_order: number | null;
  has_discord_target: boolean;
  running: boolean;
  counts: TodayQueueCounts;
  active: TodayQueueItem[];
  next: TodayQueueItem | null;
  items: TodayQueueItem[];
}

export interface TodayQueueStatusResponse {
  running: boolean;
  counts: TodayQueueCounts;
  active: TodayQueueItem[];
  next: TodayQueueItem | null;
  items: TodayQueueItem[];
  projects: TodayQueueProjectStatus[];
}

export type TodayQueueRunStatus =
  | "running"
  | "completed"
  | "stopped"
  | "failed";

export type TodayQueueTaskRunStatus =
  | "pending"
  | "active"
  | "review"
  | "completed"
  | "failed"
  | "stopped"
  | "skipped";

export interface TodayQueueRunSummary {
  id: string;
  project_id: number;
  project_name: string;
  project_emoji: string | null;
  status: TodayQueueRunStatus;
  started_by: string | null;
  started_at: string;
  completed_at: string | null;
  stopped_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  task_count: number;
  attempt_count: number;
  failed_count: number;
  duration_ms: number | null;
}

export interface TodayQueueRunListResponse {
  runs: TodayQueueRunSummary[];
  page: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  };
  filters: {
    project_id: number | null;
    status: TodayQueueRunStatus | null;
  };
}

export interface TodayQueueTaskRun {
  id: string;
  run_id: string;
  project_id: number;
  item_id: number;
  category_id: number | null;
  sequence_index: number;
  attempt: number;
  status: TodayQueueTaskRunStatus;
  item_title: string;
  item_content: string | null;
  category_name: string | null;
  issue_url: string | null;
  bot_key: string | null;
  bot_user_id: string | null;
  dispatch_nonce: string | null;
  dispatch_channel_id: string | null;
  dispatch_message_id: string | null;
  dispatch_message_url: string | null;
  result_message_id: string | null;
  result_message_url: string | null;
  git_commit: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  stopped_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TodayQueueRunDetailResponse {
  run: TodayQueueRunSummary;
  task_runs: TodayQueueTaskRun[];
}
