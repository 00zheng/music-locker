"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import {
  USER_PREFERENCES_UPDATED_EVENT,
  loadSyncedUserPreferences,
  type Playlist,
  type TrackMetadataById,
} from "@/lib/user-prefs";
import { dispatchPlayQueue } from "@/components/PlayerBridge";
import LogoutButton from "./LogoutButton";

const NAVBAR_REFRESH_INTERVAL_MS = 15000;
const PLAYLIST_COVER_SIGNED_URL_SECONDS = 60 * 60;

type SearchTrack = {
  id: string;
  title: string;
  artist: string | null;
  storage_path: string | null;
};

type BaseSearchResult = {
  id: string;
  label: string;
  detail: string;
  href: string;
  icon: "library" | "profile" | "settings" | "playlist" | "music";
};

type LinkSearchResult = BaseSearchResult & {
  kind: "link";
};

type TrackSearchResult = BaseSearchResult & {
  kind: "track";
  artist: string;
  coverDataUrl?: string | null;
  storagePath?: string | null;
  trackId: string;
};

type SearchResult = LinkSearchResult | TrackSearchResult;

type PlaylistCoverUrlsById = Record<string, string>;

function normalizeSearchValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function playlistCoverSource(playlist: Playlist | null | undefined, signedUrlsById: PlaylistCoverUrlsById) {
  if (!playlist) {
    return null;
  }

  return signedUrlsById[playlist.id] || playlist.coverDataUrl || null;
}

async function createPlaylistCoverUrls(playlists: Playlist[]) {
  const coverEntries = await Promise.all(
    playlists
      .filter((playlist) => Boolean(playlist.coverStoragePath))
      .map(async (playlist) => {
        const { data, error } = await supabase.storage
          .from("music")
          .createSignedUrl(playlist.coverStoragePath as string, PLAYLIST_COVER_SIGNED_URL_SECONDS);

        return !error && data?.signedUrl ? ([playlist.id, data.signedUrl] as const) : null;
      })
  );

  return Object.fromEntries(
    coverEntries.filter((entry): entry is readonly [string, string] => Boolean(entry))
  );
}

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
  const router = useRouter();
  const pathname = usePathname();
  const [username, setUsername] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [playlists, setPlaylistsState] = useState<Playlist[]>([]);
  const [playlistCoverUrlsById, setPlaylistCoverUrlsById] = useState<PlaylistCoverUrlsById>({});
  const [trackMetadataById, setTrackMetadataById] = useState<TrackMetadataById>({});
  const [tracks, setTracks] = useState<SearchTrack[]>([]);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let isMounted = true;
    let isLoading = false;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    async function loadNavbarData() {
      if (isLoading || !navigator.onLine) {
        return;
      }

      isLoading = true;

      try {
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user?.id;

        if (!userId || !isMounted) {
          return;
        }

        const { preferences } = await loadSyncedUserPreferences(supabase, userId);
        const signedCoverUrlsById = navigator.onLine
          ? await createPlaylistCoverUrls(preferences.playlists)
          : {};

        if (!isMounted) {
          return;
        }

        setUsername(preferences.profile.username || "");
        setAvatarDataUrl(preferences.profile.avatarDataUrl || null);
        setPlaylistsState(preferences.playlists);
        setPlaylistCoverUrlsById(signedCoverUrlsById);
        setTrackMetadataById(preferences.trackMetadata);

        const { data: trackData } = await supabase
          .from("tracks")
          .select("id,title,artist,storage_path")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (isMounted) {
          setTracks((trackData || []) as SearchTrack[]);
        }

        if (!realtimeChannel) {
          realtimeChannel = supabase
            .channel(`navbar-sync-${userId}`)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "tracks",
                filter: `user_id=eq.${userId}`,
              },
              () => void loadNavbarData()
            )
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "sync_events",
                filter: `user_id=eq.${userId}`,
              },
              () => void loadNavbarData()
            )
            .subscribe();
        }
      } finally {
        isLoading = false;
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void loadNavbarData();
      }
    }

    void loadNavbarData();
    const refreshIntervalId = window.setInterval(loadNavbarData, NAVBAR_REFRESH_INTERVAL_MS);
    window.addEventListener(USER_PREFERENCES_UPDATED_EVENT, loadNavbarData);
    window.addEventListener("focus", loadNavbarData);
    window.addEventListener("online", loadNavbarData);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      isMounted = false;
      window.clearInterval(refreshIntervalId);
      window.removeEventListener(USER_PREFERENCES_UPDATED_EVENT, loadNavbarData);
      window.removeEventListener("focus", loadNavbarData);
      window.removeEventListener("online", loadNavbarData);
      document.removeEventListener("visibilitychange", refreshWhenVisible);

      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, []);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const staticResults: SearchResult[] = [
      {
        id: "route-library",
        label: "Library",
        detail: "Playlists and folders",
        href: "/library",
        icon: "library",
        kind: "link",
      },
      {
        id: "route-profile",
        label: "Account",
        detail: "Profile, storage, password, display",
        href: "/settings",
        icon: "profile",
        kind: "link",
      },
      {
        id: "route-settings",
        label: "Settings",
        detail: "Theme and app preferences",
        href: "/settings",
        icon: "settings",
        kind: "link",
      },
    ];

    const playlistResults: SearchResult[] = playlists.map((playlist) => ({
      id: `playlist-${playlist.id}`,
      label: playlist.name,
      detail: `${playlist.trackIds.length} track${playlist.trackIds.length === 1 ? "" : "s"}`,
      href: `/library/${playlist.id}`,
      icon: "playlist" as const,
      kind: "link" as const,
    }));

    const seenTrackResults = new Set<string>();
    const trackResults: SearchResult[] = [];

    tracks.forEach((track) => {
      const parentPlaylist = playlists.find((playlist) => playlist.trackIds.includes(track.id));
      const metadata = trackMetadataById[track.id];
      const title = metadata?.title || track.title;
      const artist = metadata?.artist || track.artist || parentPlaylist?.name || "Unknown artist";
      const resultKey = `${normalizeSearchValue(title)}:${normalizeSearchValue(artist)}`;

      if (seenTrackResults.has(resultKey)) {
        return;
      }

      seenTrackResults.add(resultKey);
      trackResults.push({
        id: `track-${track.id}`,
        label: title,
        detail: artist,
        href: parentPlaylist ? `/library/${parentPlaylist.id}` : "/library",
        icon: "music" as const,
        kind: "track" as const,
        artist,
        coverDataUrl: metadata?.coverDataUrl || playlistCoverSource(parentPlaylist, playlistCoverUrlsById),
        storagePath: track.storage_path,
        trackId: track.id,
      });
    });

    const results = [...staticResults, ...playlistResults, ...trackResults];

    if (!query) {
      return results.slice(0, 8);
    }

    return results
      .filter((result) => `${result.label} ${result.detail}`.toLowerCase().includes(query))
      .slice(0, 12);
  }, [playlistCoverUrlsById, playlists, searchQuery, trackMetadataById, tracks]);

  async function playSearchTrack(result: TrackSearchResult) {
    setIsSearchOpen(false);
    setSearchQuery("");

    let storagePath = result.storagePath?.trim();

    if (!storagePath) {
      const { data: trackData } = await supabase
        .from("tracks")
        .select("storage_path")
        .eq("id", result.trackId)
        .single();

      storagePath = typeof trackData?.storage_path === "string" ? trackData.storage_path.trim() : "";
    }

    if (!storagePath) {
      router.push(result.href);
      return;
    }

    const { data, error } = await supabase.storage
      .from("music")
      .createSignedUrl(storagePath, 60 * 60);

    if (error || !data?.signedUrl) {
      router.push(result.href);
      return;
    }

    dispatchPlayQueue(
      [
        {
          id: result.trackId,
          title: result.label,
          artist: result.artist,
          coverDataUrl: result.coverDataUrl || null,
          audioUrl: data.signedUrl,
          sourceHref: result.href,
          sourceLabel: "Project",
        },
      ],
      0
    );
    router.push(result.href);
  }

  return (
    <>
    <nav className="relative z-[100] w-full border-b border-[var(--app-border)] bg-[rgba(12,12,12,0.52)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/library" className="truncate text-lg font-semibold tracking-tight text-[var(--app-text)]">
            music-locker
          </Link>
        </div>

        <div className="relative flex items-center gap-2">
          <Link
            href="/library"
            className={`flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] transition hover:bg-white/[0.12] ${
              pathname === "/library" ? "text-white" : "text-[var(--app-muted)]"
            }`}
            aria-label="Library"
            title="Library"
          >
            <NavIcon name="library" />
          </Link>

          <button
            type="button"
            onClick={() => {
              setIsProfileMenuOpen((current) => !current);
              setIsSearchOpen(false);
            }}
            className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white/[0.08] transition hover:bg-white/[0.12] ${
              pathname === "/settings" ? "text-white" : "text-[var(--app-muted)]"
            }`}
            aria-label="Account menu"
            title="Account"
          >
            {avatarDataUrl ? (
              <Image
                src={avatarDataUrl}
                alt="Profile avatar"
                width={44}
                height={44}
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <NavIcon name="profile" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(true);
              setIsProfileMenuOpen(false);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] text-white transition hover:bg-white/[0.12]"
            aria-label="Universal search"
            title="Search"
          >
            <NavIcon name="search" />
          </button>

          {isProfileMenuOpen ? (
              <div className="absolute right-0 top-14 z-[110] w-64 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[rgba(24,24,24,0.74)] shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="border-b border-white/[0.08] px-4 py-3">
                <p className="truncate text-sm font-semibold text-white">{username || "Profile"}</p>
                <p className="truncate text-xs text-[var(--app-muted)]">Account</p>
              </div>
              <Link
                href="/settings"
                onClick={() => setIsProfileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm text-[var(--app-text)] hover:bg-white/[0.08]"
              >
                <NavIcon name="profile" />
                Account settings
              </Link>
              <div className="border-t border-white/[0.08] p-3">
                <LogoutButton />
              </div>
            </div>
          ) : null}
        </div>
      </div>

    </nav>

    {isSearchOpen ? (
        <div className="fixed inset-0 z-[200] bg-black/70 px-4 py-5 backdrop-blur-sm sm:py-12">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close search"
            onClick={() => setIsSearchOpen(false)}
          />
          <div className="relative mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[rgba(22,22,22,0.78)] shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl">
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
              {searchResults.map((result) =>
                result.kind === "track" ? (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => void playSearchTrack(result)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[0.08]"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white">
                      <NavIcon name={result.icon} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">{result.label}</span>
                      <span className="block truncate text-xs text-[var(--app-muted)]">{result.detail}</span>
                    </span>
                  </button>
                ) : (
                  <Link
                    key={result.id}
                    href={result.href}
                    onClick={() => setIsSearchOpen(false)}
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
                )
              )}

              {searchResults.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-[var(--app-muted)]">
                  No results found.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
