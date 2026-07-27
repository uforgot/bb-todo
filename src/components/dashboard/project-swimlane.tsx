import type {
  TodayQueueItem,
  TodayQueueProjectStatus,
} from "@/lib/today-queue-types";
import { TaskRunNode } from "@/components/dashboard/task-run-node";

interface ProjectSwimlaneProps {
  project: TodayQueueProjectStatus;
  onSelectTask: (item: TodayQueueItem, trigger: HTMLButtonElement) => void;
}

function sortByQueueOrder(project: TodayQueueProjectStatus) {
  return project.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.today_queue_order === null && b.item.today_queue_order === null) {
        return a.index - b.index;
      }
      if (a.item.today_queue_order === null) return 1;
      if (b.item.today_queue_order === null) return -1;
      return a.item.today_queue_order - b.item.today_queue_order;
    })
    .map(({ item }) => item);
}

export function ProjectSwimlane({
  project,
  onSelectTask,
}: ProjectSwimlaneProps) {
  const items = sortByQueueOrder(project);

  return (
    <section
      data-project-id={project.project_id}
      className="grid min-w-0 overflow-hidden rounded-2xl border bg-card md:grid-cols-[14rem_minmax(0,1fr)]"
    >
      <header className="border-b bg-muted/30 p-4 md:border-r md:border-b-0">
        <div className="flex items-start justify-between gap-3 md:block">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              <span aria-hidden="true">{project.project_emoji || "📌"}</span>{" "}
              {project.project_name || `Project ${project.project_id}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {project.counts.total} tasks
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium md:mt-4">
            <span
              className={`size-2 rounded-full ${
                project.running ? "bg-emerald-500" : "bg-muted-foreground/40"
              }`}
              aria-hidden="true"
            />
            {project.running ? "Running" : "Waiting"}
          </span>
        </div>

        <dl className="mt-3 hidden grid-cols-3 gap-2 text-center text-xs md:grid">
          <div>
            <dt className="text-muted-foreground">Todo</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">
              {project.counts.todo}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Active</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">
              {project.counts.in_progress}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Review</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">
              {project.counts.review}
            </dd>
          </div>
        </dl>
      </header>

      <div className="min-w-0 p-3 md:p-4">
        <ol className="flex min-w-0 flex-col md:flex-row md:items-center md:overflow-x-auto md:pb-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col md:min-w-max md:flex-row md:items-center"
            >
              <TaskRunNode
                item={item}
                fallbackOrder={index + 1}
                onSelect={onSelectTask}
              />
              {index < items.length - 1 && (
                <span
                  className="ml-3 h-5 w-px bg-border md:ml-0 md:h-px md:w-8 md:shrink-0"
                  aria-hidden="true"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
