"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { TodoItem } from "@/components/todo-item";
import type { Project, ProjectCategory, ProjectItem } from "@/hooks/use-projects";

interface TodoSectionProps {
  project: Project;
  defaultOpen?: boolean;
  onToggle?: (id: number, checked: boolean) => void;
  onClearDone?: (project: string) => Promise<void>;
  disabled?: boolean;
  todayIds?: Set<number>;
}

function countProjectItems(project: Project) {
  let total = 0;
  let completed = 0;
  for (const it of project.items) {
    total++;
    if (it.status === "done") completed++;
  }
  for (const c of project.categories) {
    for (const it of c.items) {
      total++;
      if (it.status === "done") completed++;
    }
  }
  return { total, completed };
}

function countCategoryItems(items: ProjectItem[]) {
  const total = items.length;
  const completed = items.filter((it) => it.status === "done").length;
  return { total, completed };
}

function CompletionCount({ completed, total }: { completed: number; total: number }) {
  if (total === 0) return null;
  const allDone = completed === total;
  return (
    <span className={`text-xs tabular-nums ${allDone ? "text-green-500" : "text-muted-foreground"}`}>
      {completed}/{total}
    </span>
  );
}

/* 소구분 — 카테고리 */
function CategorySection({ category, onToggle, disabled, todayIds }: { category: ProjectCategory; onToggle?: (id: number, checked: boolean) => void; disabled?: boolean; todayIds?: Set<number> }) {
  const { total, completed } = countCategoryItems(category.items);

  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center gap-2 pb-1.5 mb-1 border-b border-border/20">
        <span className="text-xs font-semibold text-muted-foreground">
          {category.name}
        </span>
        <CompletionCount completed={completed} total={total} />
      </div>
      <div>
        {category.items.map((item) => (
          <TodoItem key={item.id} item={item} onToggle={onToggle} disabled={disabled} dimmed={todayIds?.has(item.id)} />
        ))}
      </div>
    </div>
  );
}

/* 대구분 — Project Card + Accordion */
export function TodoSection({ project, defaultOpen = true, onToggle, onClearDone, disabled, todayIds }: TodoSectionProps) {
  const { total, completed } = countProjectItems(project);
  const allDone = total > 0 && completed === total;
  const [isClearing, setIsClearing] = useState(false);

  const title = project.emoji ? `${project.emoji} ${project.name}` : project.name;

  const priorityBorder = !allDone && project.priority === 1
    ? "border-l-4 border-l-[#EF4444]"
    : !allDone && project.priority === 2
    ? "border-l-4 border-l-[#F97316]"
    : "";

  const colorBorder = !priorityBorder && project.color
    ? `border-l-4`
    : "";

  const colorStyle = !priorityBorder && project.color
    ? { borderLeftColor: project.color }
    : undefined;

  const handleClearDone = async () => {
    if (!onClearDone || isClearing) return;
    setIsClearing(true);
    try {
      await onClearDone(project.name);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Card
      className={`border shadow-none rounded-lg mb-1 ${allDone ? "border-border/30 opacity-60" : "border-border/50"} ${priorityBorder} ${colorBorder}`}
      style={colorStyle}
    >
      <Accordion
        type="single"
        collapsible
        defaultValue={defaultOpen ? title : undefined}
      >
        <AccordionItem value={title} className="border-0">
          <AccordionTrigger className="px-3 py-1 hover:no-underline hover:bg-accent/20 rounded-lg transition-colors">
            <div className="flex items-center gap-2">
              <span className={`text-base font-semibold text-balance ${allDone ? "text-muted-foreground line-through" : ""}`}>
                {title}
              </span>
              <CompletionCount completed={completed} total={total} />
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <CardContent className="pt-0 pb-1.5 px-3">
              {project.items.length > 0 && (
                <div>
                  {project.items.map((item) => (
                    <TodoItem key={item.id} item={item} onToggle={onToggle} disabled={disabled || isClearing} dimmed={todayIds?.has(item.id)} />
                  ))}
                </div>
              )}
              {project.categories.length > 0 && (
                <div className={project.items.length > 0 ? "mt-1.5" : ""}>
                  {project.categories.map((cat) => (
                    <CategorySection key={cat.id} category={cat} onToggle={onToggle} disabled={disabled || isClearing} todayIds={todayIds} />
                  ))}
                </div>
              )}
              {completed > 0 && onClearDone && (
                <button
                  onClick={handleClearDone}
                  disabled={isClearing || disabled}
                  className="mt-3 py-1 px-3 text-xs text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30 border border-green-300 dark:border-green-800 rounded-md transition-colors disabled:opacity-40"
                >
                  {isClearing ? "Clearing..." : `Clear done (${completed})`}
                </button>
              )}
            </CardContent>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
