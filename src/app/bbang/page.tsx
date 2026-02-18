"use client";

import { MemoryHistorySection } from "@/components/memory-history-section";
import { TodoHeader } from "@/components/todo-header";

export default function BbangPage() {
  return (
    <>
      <TodoHeader total={0} completed={0} countLabel="빵빵" />
      <MemoryHistorySection repo="bb-samsara" />
    </>
  );
}
