import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import ThemeBoot from "@/components/ThemeBoot";
import DeferredPlayerBridge from "@/components/DeferredPlayerBridge";

export const metadata: Metadata = {
  title: "Music Locker",
  description: "Self-hosted music bank with playlists, playback, and settings.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <RegisterServiceWorker />
        <ThemeBoot />
        <DeferredPlayerBridge />
        {children}
      </body>
    </html>
  );
}
