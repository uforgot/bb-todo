"use client";

import { MemoryHistorySection } from "@/components/memory-history-section";
import { TodoHeader } from "@/components/todo-header";
import { useEmbedded } from "@/components/embedded-provider";

export default function BbangPage() {
  const isEmbedded = useEmbedded();

  return (
    <>
      {!isEmbedded && <TodoHeader total={0} completed={0} countLabel="빵빵" />}
      <MemoryHistorySection repo="bb-samsara" />
    </>
  );
}
