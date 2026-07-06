"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { getUserProfilePreferences } from "@/lib/user-prefs";
import LogoutButton from "./LogoutButton";

export default function Navbar() {
  const pathname = usePathname();
  const [username, setUsername] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfileSummary() {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;

      if (!userId) {
        return;
      }

      const profile = getUserProfilePreferences(userId);
      setUsername(profile.username || "");
      setAvatarDataUrl(profile.avatarDataUrl || null);
    }

    void loadProfileSummary();
    window.addEventListener("music-locker:profile-updated", loadProfileSummary);

    return () => {
      window.removeEventListener("music-locker:profile-updated", loadProfileSummary);
    };
  }, [pathname]);

  const linkClass = (href: string) =>
    pathname === href
      ? "font-medium text-[var(--app-text)]"
      : "text-[var(--app-muted)] hover:text-[var(--app-text)]";

  return (
    <nav className="w-full border-b border-[var(--app-border)] bg-[#0d0d0d]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link href="/library" className="text-lg font-semibold tracking-tight text-[var(--app-text)]">
          music-locker
        </Link>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/library" className={linkClass("/library")}>
            Library
          </Link>

          <Link href="/profile" className={linkClass("/profile")}>
            Profile
          </Link>

          <Link href="/settings" className={linkClass("/settings")}>
            Settings
          </Link>

          <Link href="/profile" className="hidden items-center gap-2 sm:flex">
            {avatarDataUrl ? (
              <Image
                src={avatarDataUrl}
                alt="Profile avatar"
                width={24}
                height={24}
                unoptimized
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <div className="h-6 w-6 rounded-full border border-[var(--app-border)]" />
            )}

            <span className="text-xs text-[var(--app-muted)]">
              {username || "Anonymous"}
            </span>
          </Link>

          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
