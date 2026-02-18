"use client";

import { UsageSection } from "@/components/usage-section";
import { TodoHeader } from "@/components/todo-header";

export default function UsagePage() {
  return (
    <>
      <TodoHeader total={0} completed={0} countLabel="Usage" />
      <UsageSection />
    </>
  );
}
