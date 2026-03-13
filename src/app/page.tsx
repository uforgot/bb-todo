"use client";

import { useEffect, useCallback } from "react";
import { useProjects, type ProjectItem, type Project } from "@/hooks/use-projects";
import { useNotifications } from "@/hooks/use-notifications";
import { TodoHeader } from "@/components/todo-header";
import { TodoSection } from "@/components/todo-section";
import { TodoItem } from "@/components/todo-item";
import { Card, CardContent } from "@/components/ui/card";
import { TodoSkeleton } from "@/components/todo-skeleton";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useToast } from "@/components/ui/toast";
import { AlertCircle } from "lucide-react";

interface TodayItem {
  item: ProjectItem;
  projectName: string;
}

function collectTodayItems(projects: Project[]): TodayItem[] {
  const result: TodayItem[] = [];
  for (const project of projects) {
    const label = project.emoji ? `${project.emoji} ${project.name}` : project.name;
    for (const item of project.items) {
      if (item.is_today) {
        result.push({ item, projectName: label });
      }
    }
    for (const cat of project.categories) {
      for (const item of cat.items) {
        if (item.is_today) {
          result.push({ item, projectName: label });
        }
      }
    }
  }
  return result;
}

export default function Home() {
  const { showError } = useToast();
  const { projects, total, completed, isLoading, isError, toggle, refresh } = useProjects(showError);
  const { requestPermission, checkDeadlines } = useNotifications();

  useEffect(() => {
    if (projects.length > 0) {
      requestPermission().then(() => checkDeadlines(projects));
    }
  }, [projects, requestPermission, checkDeadlines]);

  const clearDone = useCallback(async (project: string) => {
    try {
      const res = await fetch("/api/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to clear done items");
      }

      const data = await res.json();
      if (data.count === 0) {
        return;
      }

      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to clear done items");
    }
  }, [refresh, showError]);

  if (isLoading) {
    return (
      <>
        <TodoHeader total={0} completed={0} />
        <TodoSkeleton />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <TodoHeader total={0} completed={0} />
        <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p className="text-sm">프로젝트를 불러올 수 없습니다</p>
        </div>
      </>
    );
  }

  // Sort: priority 1 → 2 → rest
  const sortedProjects = [...projects].sort((a, b) => {
    const pa = a.priority === 1 ? 0 : a.priority === 2 ? 1 : 2;
    const pb = b.priority === 1 ? 0 : b.priority === 2 ? 1 : 2;
    return pa - pb;
  });

  const todayItems = collectTodayItems(sortedProjects);
  const todayIds = new Set(todayItems.map((t) => t.item.id));

  return (
    <>
      <TodoHeader total={total} completed={completed} />
      <PullToRefresh onRefresh={refresh}>
        <main className="max-w-2xl mx-auto py-2 px-2">
          {todayItems.length > 0 && (
            <Card className="border border-border/50 shadow-none rounded-lg mb-1">
              <CardContent className="pt-2 pb-1.5 px-3">
                <span className="text-base font-semibold">⭐ 오늘</span>
                <div className="mt-1">
                  {(() => {
                    let firstLabelShown = false;
                    return todayItems.map((t, i) => {
                      const prevLabel = i > 0 ? todayItems[i - 1].projectName : null;
                      const showLabel = t.projectName !== prevLabel;
                      const isFirst = showLabel && !firstLabelShown;
                      if (showLabel) firstLabelShown = true;
                      return (
                        <TodoItem
                          key={t.item.id}
                          item={t.item}
                          onToggle={toggle}
                          sectionLabel={showLabel ? t.projectName : undefined}
                          isFirstLabel={isFirst}
                        />
                      );
                    });
                  })()}
                </div>
              </CardContent>
            </Card>
          )}
          <div className="space-y-0">
            {sortedProjects.map((project, idx) => (
              <TodoSection
                key={project.id}
                project={project}
                defaultOpen={idx < 3}
                onToggle={toggle}
                onClearDone={clearDone}
                todayIds={todayIds}
              />
            ))}
          </div>
          {projects.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              TODO 항목이 없습니다
            </p>
          )}
        </main>
      </PullToRefresh>
    </>
  );
}
