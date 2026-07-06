"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import {
  loadSyncedUserPreferences,
  type Playlist,
  type TrackMetadataById,
} from "@/lib/user-prefs";
import LogoutButton from "./LogoutButton";

type SearchTrack = {
  id: string;
  title: string;
  artist: string | null;
};

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  href: string;
  icon: "library" | "profile" | "settings" | "playlist" | "music";
};

function NavIcon({
  name,
  className = "h-4 w-4",
}: {
  name:
    | "bell"
    | "close"
    | "library"
    | "music"
    | "playlist"
    | "profile"
    | "search"
    | "settings";
  className?: string;
}) {
  const paths = {
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
    close: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    library: (
      <>
        <path d="M4 19V5" />
        <path d="M8 19V5" />
        <path d="M12 19V5" />
        <path d="m16 5 4 14" />
      </>
    ),
    music: (
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
    playlist: (
      <>
        <path d="M4 7h12" />
        <path d="M4 12h10" />
        <path d="M4 17h8" />
        <path d="m17 15 4 2-4 2v-4Z" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    settings: (
      <>
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      {paths[name]}
    </svg>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [username, setUsername] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [playlists, setPlaylistsState] = useState<Playlist[]>([]);
  const [trackMetadataById, setTrackMetadataById] = useState<TrackMetadataById>({});
  const [tracks, setTracks] = useState<SearchTrack[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function loadNavbarData() {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;

      if (!userId) {
        return;
      }

      const { preferences } = await loadSyncedUserPreferences(supabase, userId);
      setUsername(preferences.profile.username || "");
      setAvatarDataUrl(preferences.profile.avatarDataUrl || null);
      setPlaylistsState(preferences.playlists);
      setTrackMetadataById(preferences.trackMetadata);

      const { data: trackData } = await supabase
        .from("tracks")
        .select("id,title,artist")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      setTracks((trackData || []) as SearchTrack[]);
    }

    void loadNavbarData();
    window.addEventListener("music-locker:profile-updated", loadNavbarData);

    return () => {
      window.removeEventListener("music-locker:profile-updated", loadNavbarData);
    };
  }, [pathname]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const staticResults: SearchResult[] = [
      {
        id: "route-library",
        label: "Library",
        detail: "Playlists and folders",
        href: "/library",
        icon: "library",
      },
      {
        id: "route-profile",
        label: "Profile",
        detail: "Name, avatar, storage, password",
        href: "/profile",
        icon: "profile",
      },
      {
        id: "route-settings",
        label: "Settings",
        detail: "Theme and app preferences",
        href: "/settings",
        icon: "settings",
      },
    ];

    const playlistResults = playlists.map((playlist) => ({
      id: `playlist-${playlist.id}`,
      label: playlist.name,
      detail: `${playlist.trackIds.length} track${playlist.trackIds.length === 1 ? "" : "s"}`,
      href: `/library/${playlist.id}`,
      icon: "playlist" as const,
    }));

    const trackResults = tracks.map((track) => {
      const parentPlaylist = playlists.find((playlist) => playlist.trackIds.includes(track.id));
      const metadata = trackMetadataById[track.id];
      const title = metadata?.title || track.title;
      const artist = metadata?.artist || track.artist || "Unknown artist";

      return {
        id: `track-${track.id}`,
        label: title,
        detail: artist,
        href: parentPlaylist ? `/library/${parentPlaylist.id}` : "/library",
        icon: "music" as const,
      };
    });

    const results = [...staticResults, ...playlistResults, ...trackResults];

    if (!query) {
      return results.slice(0, 8);
    }

    return results
      .filter((result) => `${result.label} ${result.detail}`.toLowerCase().includes(query))
      .slice(0, 12);
  }, [playlists, searchQuery, trackMetadataById, tracks]);

  const linkClass = (href: string) =>
    pathname === href
      ? "font-medium text-[var(--app-text)]"
      : "text-[var(--app-muted)] hover:text-[var(--app-text)]";

  return (
    <nav className="w-full border-b border-[var(--app-border)] bg-[#0d0d0d]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/library" className="text-lg font-semibold tracking-tight text-[var(--app-text)]">
          music-locker
        </Link>

        <div className="hidden items-center gap-4 text-sm md:flex">
          <Link href="/library" className={linkClass("/library")}>
            Library
          </Link>

          <Link href="/profile" className={linkClass("/profile")}>
            Profile
          </Link>

          <Link href="/settings" className={linkClass("/settings")}>
            Settings
          </Link>
        </div>

        <div className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsNotificationsOpen((current) => !current);
              setIsProfileMenuOpen(false);
              setIsSearchOpen(false);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] text-white transition hover:bg-white/[0.12]"
            aria-label="Notifications"
            title="Notifications"
          >
            <NavIcon name="bell" />
          </button>

          <button
            type="button"
            onClick={() => {
              setIsProfileMenuOpen((current) => !current);
              setIsNotificationsOpen(false);
              setIsSearchOpen(false);
            }}
            className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-white/[0.08] px-3 text-white transition hover:bg-white/[0.12]"
            aria-label="Profile menu"
            title="Profile"
          >
            {avatarDataUrl ? (
              <Image
                src={avatarDataUrl}
                alt="Profile avatar"
                width={44}
                height={44}
                unoptimized
                className="h-7 w-7 rounded-full object-cover"
              />
            ) : (
              <NavIcon name="profile" />
            )}
            <span className="hidden text-sm font-medium sm:inline">Profile</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(true);
              setIsNotificationsOpen(false);
              setIsProfileMenuOpen(false);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] text-white transition hover:bg-white/[0.12]"
            aria-label="Universal search"
            title="Search"
          >
            <NavIcon name="search" />
          </button>

          {isNotificationsOpen ? (
            <div className="absolute right-0 top-14 z-50 w-72 rounded-2xl border border-[var(--app-border)] bg-[#181818] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
              <p className="text-sm font-semibold text-white">Notifications</p>
              <div className="mt-3 rounded-xl bg-white/[0.05] p-3">
                <p className="text-sm text-[var(--app-text)]">No new notifications.</p>
                <p className="mt-1 text-xs text-[var(--app-muted)]">
                  Offline downloads stay playable after they are saved.
                </p>
              </div>
            </div>
          ) : null}

          {isProfileMenuOpen ? (
            <div className="absolute right-0 top-14 z-50 w-64 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[#181818] shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
              <div className="border-b border-white/[0.08] px-4 py-3">
                <p className="truncate text-sm font-semibold text-white">{username || "Profile"}</p>
                <p className="truncate text-xs text-[var(--app-muted)]">Account</p>
              </div>
              <Link href="/profile" className="flex items-center gap-3 px-4 py-3 text-sm text-[var(--app-text)] hover:bg-white/[0.08]">
                <NavIcon name="profile" />
                Profile
              </Link>
              <Link href="/settings" className="flex items-center gap-3 px-4 py-3 text-sm text-[var(--app-text)] hover:bg-white/[0.08]">
                <NavIcon name="settings" />
                Settings
              </Link>
              <div className="border-t border-white/[0.08] p-3">
                <LogoutButton />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {isSearchOpen ? (
        <div className="fixed inset-0 z-[80] bg-black/70 px-4 py-5 backdrop-blur-sm sm:py-12">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close search"
            onClick={() => setIsSearchOpen(false)}
          />
          <div className="relative mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[#161616] shadow-[0_24px_90px_rgba(0,0,0,0.55)]">
            <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
              <NavIcon name="search" className="h-5 w-5 text-[var(--app-muted)]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search songs, playlists, pages"
                className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-[var(--app-muted)]"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setIsSearchOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-muted)] hover:bg-white/[0.08] hover:text-white"
                aria-label="Close search"
                title="Close"
              >
                <NavIcon name="close" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto p-2">
              {searchResults.map((result) => (
                <Link
                  key={result.id}
                  href={result.href}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[0.08]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white">
                    <NavIcon name={result.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">{result.label}</span>
                    <span className="block truncate text-xs text-[var(--app-muted)]">{result.detail}</span>
                  </span>
                </Link>
              ))}

              {searchResults.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-[var(--app-muted)]">
                  No results found.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
