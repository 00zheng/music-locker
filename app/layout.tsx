import type { Metadata } from "next";
import "./globals.css";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import ThemeBoot from "@/components/ThemeBoot";
import PlayerBridge from "@/components/PlayerBridge";

export const metadata: Metadata = {
  title: "Music Locker",
  description: "Self-hosted music bank with playlists, playback, and profiles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        <ThemeBoot />
        <PlayerBridge />
        {children}
      </body>
    </html>
  );
}
