import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "할일빵빵",
  description: "GitHub TODO.md PWA",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "할일빵빵",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#09090b",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${geist.className} antialiased`}>
        <ThemeProvider>
          <ToastProvider>
            <div className="flex flex-col h-[100dvh]">
              <main className="flex-1 overflow-y-auto">{children}</main>
              <BottomTabBar />
            </div>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
