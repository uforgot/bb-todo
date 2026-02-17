"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function TodoSkeleton() {
  return (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">
      <Skeleton className="h-8 w-48" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <div className="ml-4 space-y-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}
