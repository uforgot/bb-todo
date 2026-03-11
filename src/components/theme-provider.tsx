"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

function getForceTheme(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") return theme;
  return undefined;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const forcedTheme = getForceTheme();

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      forcedTheme={forcedTheme}
    >
      {children}
    </NextThemesProvider>
  );
}
