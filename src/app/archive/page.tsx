"use client";

import { useArchive } from "@/hooks/use-archive";
import { countItems } from "@/lib/parser";
import { TodoHeader } from "@/components/todo-header";
import { ArchiveSection } from "@/components/archive-section";
import { TodoSkeleton } from "@/components/todo-skeleton";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { AlertCircle } from "lucide-react";

export default function ArchivePage() {
  const { sections, isLoading, isError, refresh } = useArchive();
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
          <p className="text-sm">아카이브를 불러올 수 없습니다</p>
        </div>
      </>
    );
  }

  return (
    <>
      <TodoHeader total={total} completed={completed} />
      <PullToRefresh onRefresh={refresh}>
        <main className="max-w-2xl mx-auto py-2 px-2">
          <div className="space-y-0">
            {sections.map((section, idx) => (
              <ArchiveSection
                key={idx}
                section={section}
                defaultOpen={false}
              />
            ))}
          </div>
          {sections.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              아카이브 항목이 없습니다
            </p>
          )}
        </main>
      </PullToRefresh>
    </>
  );
}
