"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutButton";

export default function Navbar() {
  const pathname = usePathname();

  const linkClass = (href: string) =>
    pathname === href
      ? "text-white font-semibold border-b-2 border-white pb-1"
      : "text-gray-300 hover:text-white";

  return (
    <nav className="w-full border-b border-white/10 bg-black/40 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/library" className="text-xl font-bold text-white">
          music-locker
        </Link>

        <div className="flex items-center gap-6">
          <Link href="/library" className={linkClass("/library")}>
            Library
          </Link>

          <Link href="/upload" className={linkClass("/upload")}>
            Upload
          </Link>

          <Link href="/settings" className={linkClass("/settings")}>
            Settings
          </Link>

          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}