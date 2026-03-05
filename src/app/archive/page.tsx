"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useArchive, type ArchiveProject, type ArchiveCategory } from "@/hooks/use-archive";
import { TodoHeader } from "@/components/todo-header";
import { ArchiveSection } from "@/components/archive-section";
import { ArchiveSkeleton } from "@/components/archive-skeleton";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { AlertCircle, Search } from "lucide-react";

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function filterProjects(projects: ArchiveProject[], query: string): ArchiveProject[] {
  if (!query) return projects;
  const q = query.toLowerCase();

  return projects
    .map((project) => {
      const projectMatch = project.name.toLowerCase().includes(q);

      // Filter categories and their items
      const filteredCategories: ArchiveCategory[] = project.categories
        .map((cat) => {
          const catMatch = cat.name.toLowerCase().includes(q);
          const filteredItems = cat.items.filter((item) =>
            item.title.toLowerCase().includes(q)
          );
          // Keep category if its name matches or any item matches
          if (catMatch || filteredItems.length > 0) {
            return { ...cat, items: catMatch ? cat.items : filteredItems };
          }
          return null;
        })
        .filter((c): c is ArchiveCategory => c !== null);

      // Filter uncategorized items
      const filteredItems = project.items.filter((item) =>
        item.title.toLowerCase().includes(q)
      );

      // Keep project if its name matches or any child matches
      if (projectMatch || filteredCategories.length > 0 || filteredItems.length > 0) {
        return {
          ...project,
          categories: projectMatch ? project.categories : filteredCategories,
          items: projectMatch ? project.items : filteredItems,
        };
      }
      return null;
    })
    .filter((p): p is ArchiveProject => p !== null);
}

export default function ArchivePage() {
  const { projects, isLoading, isError, refresh } = useArchive();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalItems = useMemo(
    () => projects.reduce((acc, p) =>
      acc + p.items.length + p.categories.reduce((a, c) => a + c.items.length, 0), 0),
    [projects]
  );

  const filtered = useMemo(
    () => filterProjects(projects, debouncedSearch),
    [projects, debouncedSearch]
  );

  const hasSearch = debouncedSearch.length > 0;

  const handleClear = useCallback(() => {
    setSearch("");
    inputRef.current?.focus();
  }, []);

  if (isLoading) {
    return (
      <>
        <TodoHeader total={0} completed={0} />
        <ArchiveSkeleton />
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
      <TodoHeader total={totalItems} completed={totalItems} />
      <PullToRefresh onRefresh={refresh}>
        <main className="max-w-2xl mx-auto py-2 px-2">
          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색..."
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                onClick={handleClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="space-y-0">
            {filtered.map((project) => (
              <ArchiveSection
                key={project.id}
                project={project}
                defaultOpen={hasSearch}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              {hasSearch ? "검색 결과가 없습니다" : "아카이브 항목이 없습니다"}
            </p>
          )}
        </main>
      </PullToRefresh>
    </>
  );
}
