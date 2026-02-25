"use client";

import { useEffect } from "react";
import { useTodo } from "@/hooks/use-todo";
import { countItems, type TodoItem as TodoItemType, type TodoSection as TodoSectionType } from "@/lib/parser";
import { TodoHeader } from "@/components/todo-header";
import { TodoSection } from "@/components/todo-section";
import { TodoItem } from "@/components/todo-item";
import { Card, CardContent } from "@/components/ui/card";
import { TodoSkeleton } from "@/components/todo-skeleton";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useToast } from "@/components/ui/toast";
import { useNotifications } from "@/hooks/use-notifications";
import { AlertCircle } from "lucide-react";

interface TodayItem {
  item: TodoItemType;
  sectionTitle: string;
}

function collectTodayItems(sections: TodoSectionType[], parentTitle?: string): TodayItem[] {
  const result: TodayItem[] = [];
  for (const section of sections) {
    const label = parentTitle || section.title;
    for (const item of section.items) {
      if (item.today) {
        result.push({ item, sectionTitle: label });
      }
    }
    result.push(...collectTodayItems(section.children, label));
  }
  return result;
}

export default function Home() {
  const { showError } = useToast();
  const { sections, isLoading, isError, toggle, refresh, isFlushing } = useTodo(showError);
  const { total, completed } = countItems(sections);
  const { requestPermission, checkDeadlines } = useNotifications();

  useEffect(() => {
    if (sections.length > 0) {
      requestPermission().then(() => checkDeadlines(sections));
    }
  }, [sections, requestPermission, checkDeadlines]);

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
          <p className="text-sm">TODO.md를 불러올 수 없습니다</p>
        </div>
      </>
    );
  }

  // level 1 래퍼 건너뛰고 children 바로 렌더링
  const flatSections = sections.length === 1 && sections[0].children.length > 0
    ? sections[0].children
    : sections;

  // Sort: !1 → !2 → none
  const priorityOrder = (s: TodoSectionType) => s.priority === '!1' ? 0 : s.priority === '!2' ? 1 : 2;
  const sortedSections = [...flatSections].sort((a, b) => priorityOrder(a) - priorityOrder(b));

  const todayItems = collectTodayItems(sortedSections);
  const todayLines = new Set(todayItems.map((t) => t.item.line));

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
                  {todayItems.map((t, i) => {
                    const prevLabel = i > 0 ? todayItems[i - 1].sectionTitle : null;
                    const showLabel = t.sectionTitle !== prevLabel;
                    return (
                      <TodoItem
                        key={t.item.line}
                        item={t.item}
                        onToggle={toggle}
                        disabled={isFlushing}
                        sectionLabel={showLabel ? t.sectionTitle : undefined}
                      />
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
          <div className="space-y-0">
            {sortedSections.map((section, idx) => (
              <TodoSection
                key={idx}
                section={section}
                defaultOpen={idx < 3}
                onToggle={toggle}
                isFlushing={isFlushing}
                todayLines={todayLines}
              />
            ))}
          </div>
          {flatSections.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              TODO 항목이 없습니다
            </p>
          )}
        </main>
      </PullToRefresh>
    </>
  );
}
