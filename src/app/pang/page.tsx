"use client";

import { MemoryHistorySection } from "@/components/memory-history-section";
import { TodoHeader } from "@/components/todo-header";
import { useEmbedded } from "@/components/embedded-provider";

export default function PangPage() {
  const isEmbedded = useEmbedded();

  return (
    <>
      {!isEmbedded && <TodoHeader total={0} completed={0} countLabel="팡팡" />}
      <MemoryHistorySection repo="pp-samsara" />
    </>
  );
}
