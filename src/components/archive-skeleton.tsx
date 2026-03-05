"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function ArchiveSkeleton() {
  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {/* Search bar skeleton */}
      <Skeleton className="h-10 w-full rounded-lg mb-2" />
      {/* Collapsed accordion cards */}
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-11 w-full rounded-lg mb-1" />
      ))}
    </div>
  );
}
