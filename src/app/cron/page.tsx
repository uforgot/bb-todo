"use client";

import { CronSection } from "@/components/cron-section";
import { TodoHeader } from "@/components/todo-header";

export default function CronPage() {
  return (
    <>
      <TodoHeader total={0} completed={0} />
      <CronSection />
    </>
  );
}
