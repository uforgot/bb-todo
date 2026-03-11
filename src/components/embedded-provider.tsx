"use client";

import { createContext, useContext } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const EmbeddedContext = createContext(false);

export function useEmbedded() {
  return useContext(EmbeddedContext);
}

function EmbeddedDetector({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const isEmbedded = searchParams.get("embedded") === "true";

  return (
    <EmbeddedContext.Provider value={isEmbedded}>
      {children}
    </EmbeddedContext.Provider>
  );
}

export function EmbeddedProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <EmbeddedDetector>{children}</EmbeddedDetector>
    </Suspense>
  );
}
