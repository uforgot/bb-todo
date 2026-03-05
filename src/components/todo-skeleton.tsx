"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function TodoSkeleton() {
  return (
    <div className="max-w-2xl mx-auto py-2 px-2">
      {/* Header skeleton */}
      <Skeleton className="h-6 w-32 mb-3 mx-1" />
      {/* Expanded first card */}
      <div className="rounded-lg border border-border/50 mb-1 p-3">
        <Skeleton className="h-5 w-48 mb-3" />
        <div className="space-y-2 ml-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      {/* Collapsed cards */}
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-11 w-full rounded-lg mb-1" />
      ))}
    </div>
  );
}
