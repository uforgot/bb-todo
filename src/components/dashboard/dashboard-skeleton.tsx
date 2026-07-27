import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading queue dashboard">
      {[0, 1, 2].map((lane) => (
        <div
          key={lane}
          className="grid overflow-hidden rounded-2xl border md:grid-cols-[14rem_minmax(0,1fr)]"
        >
          <div className="border-b p-4 md:border-r md:border-b-0">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-2 h-3 w-20" />
            <Skeleton className="mt-5 hidden h-8 w-full md:block" />
          </div>
          <div className="flex flex-col gap-5 p-3 md:flex-row md:items-center md:gap-0 md:overflow-hidden md:p-4">
            {[0, 1, 2].map((node) => (
              <div key={node} className="flex items-center md:shrink-0">
                <div className="w-full rounded-xl border p-3 md:h-36 md:w-64">
                  <div className="flex justify-between">
                    <Skeleton className="size-7 rounded-full" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="mt-3 h-4 w-4/5" />
                  <Skeleton className="mt-2 h-4 w-3/5" />
                  <Skeleton className="mt-4 h-3 w-24" />
                </div>
                {node < 2 && (
                  <div className="hidden h-px w-8 bg-border md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
