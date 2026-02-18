"use client";

import { CronSection } from "@/components/cron-section";
import { TodoHeader } from "@/components/todo-header";
import { useCron } from "@/hooks/use-cron";

export default function CronPage() {
  const { jobs } = useCron();

  return (
    <>
      <TodoHeader total={0} completed={0} countLabel={jobs.length > 0 ? `${jobs.length}개` : undefined} />
      <CronSection />
    </>
  );
}
