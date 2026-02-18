"use client";

import { useTodo } from "@/hooks/use-todo";
import { countItems } from "@/lib/parser";
import { TodoHeader } from "@/components/todo-header";
import { TodoSection } from "@/components/todo-section";
import { TodoSkeleton } from "@/components/todo-skeleton";
import { CronSection } from "@/components/cron-section";
import { AlertCircle } from "lucide-react";

export default function Home() {
  const { sections, isLoading, isError } = useTodo();
  const { total, completed } = countItems(sections);

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

  return (
    <>
      <TodoHeader total={total} completed={completed} />
      <main className="max-w-2xl mx-auto py-2 px-2">
        <div className="space-y-0">
          {sections.map((section, idx) => (
            <TodoSection key={idx} section={section} defaultOpen={idx < 3} />
          ))}
        </div>
        {sections.length === 0 && (
          <p className="text-center text-muted-foreground py-8 text-sm">
            TODO 항목이 없습니다
          </p>
        )}
      </main>
      <hr className="max-w-2xl mx-auto border-border/30 my-2" />
      <CronSection />
    </>
  );
}
