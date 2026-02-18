"use client";

import { MemoryHistorySection } from "@/components/memory-history-section";
import { TodoHeader } from "@/components/todo-header";

export default function PangPage() {
  return (
    <>
      <TodoHeader total={0} completed={0} countLabel="팡팡" />
      <MemoryHistorySection repo="pp-samsara" />
    </>
  );
}
