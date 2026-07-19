"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import {
  loadSyncedUserPreferences,
  saveSyncedUserPreferences,
  type Playlist,
  type SyncedUserPreferences,
  type TrackMetadataById,
} from "@/lib/user-prefs";
import {
  CURRENT_TRACK_EVENT,
  dispatchAppendQueue,
  dispatchPlayQueue,
  getCurrentTrackId,
} from "@/components/player-events";

type Track = {
  id: string;
  title: string;
  artist: string | null;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  signedUrl?: string;
  signedUrlExpiresAt?: number;
  offlineUrl?: string;
  isOfflineAvailable?: boolean;
  offlineOnly?: boolean;
};

type OfflineTrackRecord = {
  id: string;
  title: string;
  artist: string | null;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
};

const OFFLINE_AUDIO_CACHE = "music-locker-audio-v1";
const OFFLINE_TRACKS_PREFIX = "music-locker-offline-tracks:";
const ALL_TRACKS_PLAYLIST_ID = "all-tracks";
const PREFERENCES_REFRESH_INTERVAL_MS = 8000;
const TRACKS_REFRESH_INTERVAL_MS = 30000;
const PLAYLIST_COVER_SIZE = 800;
const PLAYLIST_COVER_QUALITY = 0.82;
const PLAYLIST_COVER_SIGNED_URL_SECONDS = 60 * 60;
const TRACK_SIGNED_URL_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_WINDOW_MS = 5 * 60 * 1000;

type LoadDataOptions = {
  showLoading?: boolean;
  clearStatus?: boolean;
};

type PlaylistCoverUrlsById = Record<string, string>;

type LibraryDataCache = {
  user: User;
  tracks: Track[];
  playlists: Playlist[];
  playlistCoverUrlsById: PlaylistCoverUrlsById;
  trackMetadataById: TrackMetadataById;
  updatedAt: number;
};

let libraryDataCache: LibraryDataCache | null = null;

function offlineObjectUrlsFromTracks(tracks: Track[]) {
  return tracks
    .map((track) => track.offlineUrl)
    .filter((url): url is string => Boolean(url));
}

function offlineAudioRequest(trackId: string) {
  return new Request(`/offline-audio/${trackId}`);
}

function offlineTracksKey(userId: string) {
  return `${OFFLINE_TRACKS_PREFIX}${userId}`;
}

function readOfflineTrackRecords(userId: string): OfflineTrackRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(offlineTracksKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOfflineTrackRecords(userId: string, tracks: OfflineTrackRecord[]) {
  localStorage.setItem(offlineTracksKey(userId), JSON.stringify(tracks));
}

function saveOfflineTrackRecord(userId: string, track: Track) {
  const existingTracks = readOfflineTrackRecords(userId);
  const record: OfflineTrackRecord = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    storage_path: track.storage_path,
    mime_type: track.mime_type,
    file_size: track.file_size,
    created_at: track.created_at,
  };

  writeOfflineTrackRecords(userId, [
    record,
    ...existingTracks.filter((savedTrack) => savedTrack.id !== track.id),
  ]);
}

function removeOfflineTrackRecord(userId: string, trackId: string) {
  writeOfflineTrackRecords(
    userId,
    readOfflineTrackRecords(userId).filter((track) => track.id !== trackId)
  );
}

async function getCachedAudioUrl(trackId: string) {
  if (!("caches" in window)) {
    return undefined;
  }

  const cache = await caches.open(OFFLINE_AUDIO_CACHE);
  const response = await cache.match(offlineAudioRequest(trackId));

  if (!response) {
    return undefined;
  }

  return URL.createObjectURL(await response.blob());
}

function playlistCoverStoragePath(userId: string, playlistId: string) {
  return `${userId}/.music-locker/playlist-covers/${playlistId}-${Date.now()}.jpg`;
}

function hasFreshSignedUrl(track: Track) {
  return Boolean(
    track.signedUrl &&
      track.signedUrlExpiresAt &&
      track.signedUrlExpiresAt > Date.now() + SIGNED_URL_REFRESH_WINDOW_MS
  );
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

async function imageFileToPlaylistCoverBlob(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Cover art must be an image.");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Could not read image file."));
      nextImage.src = objectUrl;
    });
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);

    if (!sourceSize) {
      throw new Error("Could not read image dimensions.");
    }

    const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
    const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = PLAYLIST_COVER_SIZE;
    canvas.height = PLAYLIST_COVER_SIZE;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare cover art.");
    }

    context.fillStyle = "#0b0b0b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(new Error("Could not prepare cover art."));
        },
        "image/jpeg",
        PLAYLIST_COVER_QUALITY
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function formatCount(count: number) {
  return `${count} item${count === 1 ? "" : "s"}`;
}

function formatTrackDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatFileSize(value: number | null) {
  if (!value) {
    return "Unknown size";
  }

  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

type InlineIconName = "play" | "add" | "back" | "more" | "queue" | "edit" | "download" | "remove" | "trash";

function InlineIcon({
  name,
  className = "h-4 w-4",
}: {
  name: InlineIconName;
  className?: string;
}) {
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
      {name === "play" ? (
        <path d="m8 5 11 7-11 7V5Z" />
      ) : name === "back" ? (
        <>
          <path d="m15 18-6-6 6-6" />
          <path d="M9 12h12" />
        </>
      ) : name === "more" ? (
        <>
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      ) : name === "add" ? (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      ) : name === "queue" ? (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h10" />
          <path d="m17 17 3 3 3-3" />
        </>
      ) : name === "edit" ? (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
        </>
      ) : name === "download" ? (
        <>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </>
      ) : name === "remove" ? (
        <>
          <path d="M5 12h14" />
          <path d="M4 5h16" />
          <path d="M6 5l1 16h10l1-16" />
        </>
      ) : name === "trash" ? (
        <>
          <path d="M4 7h16" />
          <path d="M6 7l1 14h10l1-14" />
          <path d="M9 7V4h6v3" />
        </>
      ) : (
        <>
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
          <path d="M3 9h18" />
        </>
      )}
    </svg>
  );
}

function ActionSheet({
  label,
  children,
  onClose,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="app-sheet-backdrop fixed inset-0 z-[1200] flex items-end justify-center bg-black/45 px-3 backdrop-blur-sm sm:items-center sm:px-6"
      onClick={onClose}
    >
      <div
        className="app-sheet-panel w-full max-w-lg overflow-hidden rounded-t-[28px] border border-[var(--app-border)] bg-[var(--app-bg-soft)] text-[var(--app-text)] shadow-[0_28px_90px_rgba(0,0,0,0.32)] backdrop-blur-2xl sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="max-h-[88svh] overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-5">
          <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-[var(--app-glass-strong)]" />
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

function ActionSheetButton({
  icon,
  children,
  onClick,
  disabled = false,
  tone = "default",
}: {
  icon: InlineIconName;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-14 w-full items-center gap-4 rounded-2xl px-3 py-3 text-left text-base font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === "danger"
          ? "text-[var(--app-danger-text)] hover:bg-[var(--app-danger-bg)]"
          : "text-[var(--app-text)] hover:bg-[var(--app-glass)]"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          tone === "danger" ? "bg-[var(--app-danger-bg)] text-[var(--app-danger-text)]" : "bg-[var(--app-glass)] text-[var(--app-muted)]"
        }`}
      >
        <InlineIcon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const selectedPlaylistSegment = useSelectedLayoutSegment();
  const playlistId = selectedPlaylistSegment ? decodeURIComponent(selectedPlaylistSegment) : undefined;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylistsState] = useState<Playlist[]>([]);
  const [playlistCoverUrlsById, setPlaylistCoverUrlsById] = useState<PlaylistCoverUrlsById>({});
  const [trackMetadataById, setTrackMetadataById] = useState<TrackMetadataById>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [openTrackMenuId, setOpenTrackMenuId] = useState<string | null>(null);
  const [openPlaylistMenuId, setOpenPlaylistMenuId] = useState<string | null>(null);
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [playlistRenameValue, setPlaylistRenameValue] = useState("");
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(() => getCurrentTrackId());
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [lastSelectedTrackId, setLastSelectedTrackId] = useState<string | null>(null);
  const [isDeletingTracks, setIsDeletingTracks] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const offlineObjectUrlsRef = useRef<string[]>([]);
  const isLoadingDataRef = useRef(false);
  const isSavingPreferencesRef = useRef(false);
  const playlistCoverUrlsByIdRef = useRef<PlaylistCoverUrlsById>({});

  const allTracksPlaylist = useMemo<Playlist>(
    () => ({
      id: ALL_TRACKS_PLAYLIST_ID,
      name: "All tracks",
      trackIds: tracks.map((track) => track.id),
      manualOrder: -1,
      createdAt: "",
      coverDataUrl: null,
      coverStoragePath: null,
    }),
    [tracks]
  );

  const activePlaylist = useMemo(
    () =>
      playlistId === ALL_TRACKS_PLAYLIST_ID
        ? allTracksPlaylist
        : playlists.find((playlist) => playlist.id === playlistId) || null,
    [allTracksPlaylist, playlistId, playlists]
  );

  const isAllTracksView = playlistId === ALL_TRACKS_PLAYLIST_ID;

  const playlistCoverUrl = useMemo(
    () => playlistCoverSource(activePlaylist, playlistCoverUrlsById),
    [activePlaylist, playlistCoverUrlsById]
  );

  const activeTrackIds = useMemo(() => {
    if (!activePlaylist) {
      return [];
    }

    return activePlaylist.trackIds;
  }, [activePlaylist]);

  const tracksById = useMemo(
    () => new Map(tracks.map((track) => [track.id, track])),
    [tracks]
  );

  const activeTrackIdSet = useMemo(
    () => new Set(activeTrackIds),
    [activeTrackIds]
  );

  const activeTrackOrder = useMemo(
    () => new Map(activeTrackIds.map((trackId, index) => [trackId, index])),
    [activeTrackIds]
  );

  const visibleTracks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filteredTracks = tracks.filter((track) => {
      if (playlistId && !activeTrackIdSet.has(track.id)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const meta = trackMetadataById[track.id];
      const haystack = [
        meta?.title || track.title,
        meta?.artist || track.artist || "",
        meta?.album || "",
        meta?.genre || "",
        activePlaylist?.name || "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });

    if (!playlistId) {
      return filteredTracks;
    }

    return filteredTracks.sort(
      (a, b) => (activeTrackOrder.get(a.id) ?? 0) - (activeTrackOrder.get(b.id) ?? 0)
    );
  }, [activePlaylist?.name, activeTrackIdSet, activeTrackOrder, playlistId, searchQuery, trackMetadataById, tracks]);

  const visiblePlaylists = useMemo(
    () => [...playlists].sort((a, b) => a.manualOrder - b.manualOrder),
    [playlists]
  );

  const selectedTrackIdsInLibrary = useMemo(
    () => selectedTrackIds.filter((trackId) => tracksById.has(trackId)),
    [selectedTrackIds, tracksById]
  );

  const selectedTrackIdSet = useMemo(
    () => new Set(selectedTrackIdsInLibrary),
    [selectedTrackIdsInLibrary]
  );

  const availableActiveTrackCount = useMemo(
    () => activeTrackIds.filter((trackId) => tracksById.has(trackId)).length,
    [activeTrackIds, tracksById]
  );
  const unavailableActiveTrackCount = Math.max(0, activeTrackIds.length - availableActiveTrackCount);
  const displayName = user?.email || "Music Locker";

  const replaceTracks = useCallback((nextTracks: Track[]) => {
    offlineObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    offlineObjectUrlsRef.current = offlineObjectUrlsFromTracks(nextTracks);
    setTracks(nextTracks);
  }, []);

  const hydrateLibraryFromCache = useCallback((cachedData: LibraryDataCache) => {
    offlineObjectUrlsRef.current = offlineObjectUrlsFromTracks(cachedData.tracks);
    setUser(cachedData.user);
    setTracks(cachedData.tracks);
    setPlaylistsState(cachedData.playlists);
    playlistCoverUrlsByIdRef.current = cachedData.playlistCoverUrlsById;
    setPlaylistCoverUrlsById(cachedData.playlistCoverUrlsById);
    setTrackMetadataById(cachedData.trackMetadataById);
    setLoading(false);
  }, []);

  useEffect(() => {
    playlistCoverUrlsByIdRef.current = playlistCoverUrlsById;
  }, [playlistCoverUrlsById]);

  useEffect(() => {
    if (!user || loading) {
      return;
    }

    libraryDataCache = {
      user,
      tracks,
      playlists,
      playlistCoverUrlsById,
      trackMetadataById,
      updatedAt: Date.now(),
    };
  }, [loading, playlistCoverUrlsById, playlists, trackMetadataById, tracks, user]);

  useEffect(() => {
    function handleCurrentTrack(event: Event) {
      const customEvent = event as CustomEvent<{ trackId: string | null }>;
      setCurrentTrackId(customEvent.detail.trackId);
    }

    window.addEventListener(CURRENT_TRACK_EVENT, handleCurrentTrack as EventListener);
    return () => window.removeEventListener(CURRENT_TRACK_EVENT, handleCurrentTrack as EventListener);
  }, []);

  useEffect(() => {
    if (!openPlaylistMenuId && !openTrackMenuId) {
      return;
    }

    function closeMenusOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setOpenPlaylistMenuId(null);
      setOpenTrackMenuId(null);
      setRenamingPlaylistId(null);
      setPlaylistRenameValue("");
    }

    window.addEventListener("keydown", closeMenusOnEscape);
    return () => window.removeEventListener("keydown", closeMenusOnEscape);
  }, [openPlaylistMenuId, openTrackMenuId]);

  const attachOfflineInfo = useCallback(async (inputTracks: Track[]) => {
    const tracksWithOfflineInfo = await Promise.all(
      inputTracks.map(async (track) => {
        const offlineUrl = await getCachedAudioUrl(track.id);

        return {
          ...track,
          offlineUrl,
          isOfflineAvailable: Boolean(offlineUrl),
        };
      })
    );

    return tracksWithOfflineInfo;
  }, []);

  const applySyncedPreferences = useCallback((
    preferences: SyncedUserPreferences,
    signedCoverUrlsById: PlaylistCoverUrlsById = {}
  ) => {
    setTrackMetadataById(preferences.trackMetadata);
    setPlaylistsState(preferences.playlists);
    playlistCoverUrlsByIdRef.current = signedCoverUrlsById;
    setPlaylistCoverUrlsById(signedCoverUrlsById);
  }, []);

  function persistSyncedPreferences(
    value: Partial<SyncedUserPreferences>,
    successMessage?: string
  ) {
    if (!user) {
      return Promise.resolve();
    }

    isSavingPreferencesRef.current = true;

    return saveSyncedUserPreferences(supabase, user.id, value)
      .then(({ preferences, error }) => {
        if (error) {
          setStatus(`Saved on this device. Cloud sync failed: ${error.message}`);
          return;
        }

        applySyncedPreferences(preferences, playlistCoverUrlsByIdRef.current);

        if (successMessage) {
          setStatus(successMessage);
        }
      })
      .finally(() => {
        isSavingPreferencesRef.current = false;
      });
  }

  function persistPlaylists(nextPlaylists: Playlist[], successMessage?: string) {
    setPlaylistsState(nextPlaylists);
    return persistSyncedPreferences({ playlists: nextPlaylists }, successMessage);
  }

  function persistTrackMetadata(nextMetadata: TrackMetadataById, successMessage?: string) {
    setTrackMetadataById(nextMetadata);
    return persistSyncedPreferences({ trackMetadata: nextMetadata }, successMessage);
  }

  const loadData = useCallback(async (options: LoadDataOptions = {}) => {
    if (isLoadingDataRef.current || isSavingPreferencesRef.current) {
      return;
    }

    isLoadingDataRef.current = true;
    const { showLoading = true, clearStatus = true } = options;

    if (showLoading) {
      setLoading(true);
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      let currentUser = sessionData.session?.user ?? null;

      if (!currentUser && navigator.onLine) {
        const { data: userData } = await supabase.auth.getUser();
        currentUser = userData.user;
      }

      if (!currentUser) {
        router.push("/login");
        return;
      }

      setUser((existingUser) => (existingUser?.id === currentUser.id ? existingUser : currentUser));

      const cachedData =
        libraryDataCache?.user.id === currentUser.id ? libraryDataCache : null;

      if (cachedData && showLoading) {
        hydrateLibraryFromCache(cachedData);

        if (clearStatus) {
          setStatus("");
        }
      }

      const { preferences } = await loadSyncedUserPreferences(supabase, currentUser.id);
      const signedCoverUrlsById = navigator.onLine
        ? await createPlaylistCoverUrls(preferences.playlists)
        : {};

      const { data, error } = await supabase
        .from("tracks")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false });

      if (error) {
        const offlineTracks = readOfflineTrackRecords(currentUser.id).map((track) => ({
          ...track,
          offlineOnly: true,
        }));
        const offlineTracksWithUrls = await attachOfflineInfo(offlineTracks);
        const availableOfflineTracks = offlineTracksWithUrls.filter((track) => track.isOfflineAvailable);

        replaceTracks(availableOfflineTracks);
        applySyncedPreferences(preferences, signedCoverUrlsById);
        setStatus(
          availableOfflineTracks.length > 0
            ? "Offline mode: showing downloaded songs only."
            : "Offline mode: no downloaded songs available."
        );
        return;
      }

      const tracksWithOfflineInfo = await attachOfflineInfo((data || []) as Track[]);

      replaceTracks(tracksWithOfflineInfo);
      applySyncedPreferences(preferences, signedCoverUrlsById);

      if (clearStatus) {
        setStatus("");
      }
    } finally {
      isLoadingDataRef.current = false;
      setLoading(false);
    }
  }, [applySyncedPreferences, attachOfflineInfo, hydrateLibraryFromCache, replaceTracks, router]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [loadData]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const userId = user.id;
    let isRefreshingPreferences = false;

    async function refreshPreferences() {
      if (
        isRefreshingPreferences ||
        isSavingPreferencesRef.current ||
        document.visibilityState !== "visible" ||
        !navigator.onLine
      ) {
        return;
      }

      isRefreshingPreferences = true;

      try {
        const { preferences } = await loadSyncedUserPreferences(supabase, userId);
        const signedCoverUrlsById = await createPlaylistCoverUrls(preferences.playlists);
        applySyncedPreferences(preferences, signedCoverUrlsById);
      } finally {
        isRefreshingPreferences = false;
      }
    }

    function refreshLibrary() {
      if (
        isSavingPreferencesRef.current ||
        document.visibilityState !== "visible" ||
        !navigator.onLine
      ) {
        return;
      }

      void loadData({ showLoading: false, clearStatus: false });
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        refreshLibrary();
      }
    }

    const preferencesIntervalId = window.setInterval(refreshPreferences, PREFERENCES_REFRESH_INTERVAL_MS);
    const tracksIntervalId = window.setInterval(refreshLibrary, TRACKS_REFRESH_INTERVAL_MS);
    const realtimeChannel = supabase
      .channel(`library-sync-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tracks",
          filter: `user_id=eq.${userId}`,
        },
        refreshLibrary
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sync_events",
          filter: `user_id=eq.${userId}`,
        },
        refreshLibrary
      )
      .subscribe();

    window.addEventListener("focus", refreshLibrary);
    window.addEventListener("online", refreshLibrary);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(preferencesIntervalId);
      window.clearInterval(tracksIntervalId);
      window.removeEventListener("focus", refreshLibrary);
      window.removeEventListener("online", refreshLibrary);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void supabase.removeChannel(realtimeChannel);
    };
  }, [applySyncedPreferences, loadData, user]);

  function handleTrackClick(event: MouseEvent, trackId: string, index: number) {
    if (event.shiftKey) {
      event.preventDefault();
      const anchorIndex = lastSelectedTrackId
        ? visibleTracks.findIndex((track) => track.id === lastSelectedTrackId)
        : -1;
      const startIndex = anchorIndex >= 0 ? Math.min(anchorIndex, index) : index;
      const endIndex = anchorIndex >= 0 ? Math.max(anchorIndex, index) : index;
      const rangeTrackIds = visibleTracks.slice(startIndex, endIndex + 1).map((track) => track.id);

      setSelectedTrackIds((currentIds) => Array.from(new Set([...currentIds, ...rangeTrackIds])));
      setLastSelectedTrackId(trackId);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      setSelectedTrackIds((currentIds) =>
        currentIds.includes(trackId)
          ? currentIds.filter((currentTrackId) => currentTrackId !== trackId)
          : [...currentIds, trackId]
      );
      setLastSelectedTrackId(trackId);
      return;
    }

    void playTrackAtIndex(index);
  }

  async function deleteTracks(trackIds: string[]) {
    if (!user || trackIds.length === 0) {
      return;
    }

    const uniqueTrackIds = Array.from(new Set(trackIds));
    const tracksToDelete = uniqueTrackIds
      .map((trackId) => tracksById.get(trackId))
      .filter((track): track is Track => Boolean(track));

    if (tracksToDelete.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${tracksToDelete.length} track${tracksToDelete.length === 1 ? "" : "s"} from your account? This removes the audio from every device and playlist.`
    );

    if (!confirmed) {
      setOpenTrackMenuId(null);
      return;
    }

    setIsDeletingTracks(true);
    setStatus(`Deleting ${tracksToDelete.length} track${tracksToDelete.length === 1 ? "" : "s"}...`);

    const storagePaths = tracksToDelete
      .map((track) => track.storage_path)
      .filter((path): path is string => Boolean(path));

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage.from("music").remove(storagePaths);

      if (storageError) {
        setStatus(storageError.message);
        setIsDeletingTracks(false);
        return;
      }
    }

    const { error: deleteError } = await supabase
      .from("tracks")
      .delete()
      .eq("user_id", user.id)
      .in("id", uniqueTrackIds);

    if (deleteError) {
      setStatus(deleteError.message);
      setIsDeletingTracks(false);
      return;
    }

    if ("caches" in window) {
      const cache = await caches.open(OFFLINE_AUDIO_CACHE);
      await Promise.all(uniqueTrackIds.map((trackId) => cache.delete(offlineAudioRequest(trackId))));
    }

    uniqueTrackIds.forEach((trackId) => removeOfflineTrackRecord(user.id, trackId));

    const deletedTrackIdSet = new Set(uniqueTrackIds);
    const nextPlaylists = playlists.map((playlist) => ({
      ...playlist,
      trackIds: playlist.trackIds.filter((trackId) => !deletedTrackIdSet.has(trackId)),
    }));
    const nextTrackMetadata = { ...trackMetadataById };
    uniqueTrackIds.forEach((trackId) => {
      delete nextTrackMetadata[trackId];
    });

    setPlaylistsState(nextPlaylists);
    setTrackMetadataById(nextTrackMetadata);
    setSelectedTrackIds((currentIds) => currentIds.filter((trackId) => !deletedTrackIdSet.has(trackId)));
    setLastSelectedTrackId((trackId) => (trackId && deletedTrackIdSet.has(trackId) ? null : trackId));
    setOpenTrackMenuId(null);
    await persistSyncedPreferences(
      { playlists: nextPlaylists, trackMetadata: nextTrackMetadata },
      `${tracksToDelete.length} track${tracksToDelete.length === 1 ? "" : "s"} deleted and synced.`
    );
    setIsDeletingTracks(false);
    await loadData();
  }

  function createPlaylist() {
    if (!user) {
      return;
    }

    const nextPlaylists = [
      ...playlists,
      {
        id: crypto.randomUUID(),
        name: "untitled playlist",
        trackIds: [],
        manualOrder: playlists.length,
        createdAt: new Date().toISOString(),
        coverDataUrl: null,
        coverStoragePath: null,
      },
    ];

    void persistPlaylists(nextPlaylists, "Playlist created and synced.");
  }

  function startRenamingPlaylist(playlist: Playlist) {
    setRenamingPlaylistId(playlist.id);
    setPlaylistRenameValue(playlist.name);
  }

  function cancelRenamingPlaylist() {
    setRenamingPlaylistId(null);
    setPlaylistRenameValue("");
  }

  function savePlaylistName(playlistId: string) {
    if (!user) {
      return;
    }

    const nextName = playlistRenameValue.trim();

    if (!nextName) {
      return;
    }

    const nextPlaylists = playlists.map((playlist) =>
      playlist.id === playlistId ? { ...playlist, name: nextName } : playlist
    );

    persistPlaylists(nextPlaylists, "Playlist renamed and synced.");
    setRenamingPlaylistId(null);
    setPlaylistRenameValue("");
    setOpenPlaylistMenuId(null);
  }

  function deletePlaylist(playlist: Playlist) {
    if (!user) {
      return;
    }

    const confirmed = window.confirm(`Delete "${playlist.name}"? Songs in the playlist will stay in your library.`);

    if (!confirmed) {
      setOpenPlaylistMenuId(null);
      return;
    }

    const nextPlaylists = playlists
      .filter((currentPlaylist) => currentPlaylist.id !== playlist.id)
      .map((currentPlaylist, index) => ({
        ...currentPlaylist,
        manualOrder: index,
      }));

    setPlaylistsState(nextPlaylists);
    persistSyncedPreferences(
      {
        playlists: nextPlaylists,
        deletedPlaylistIds: [playlist.id],
      },
      "Playlist deleted and synced."
    );
    setOpenPlaylistMenuId(null);
  }

  async function uploadTrackFiles(fileList: FileList | null) {
    const selectedFiles = Array.from(fileList || []);

    if (!user || selectedFiles.length === 0) {
      return;
    }

    if (!activePlaylist || isAllTracksView) {
      setStatus("Open a playlist before adding tracks.");
      return;
    }

    setIsUploading(true);
    setStatus(`Uploading ${selectedFiles.length} track${selectedFiles.length === 1 ? "" : "s"}...`);

    const insertedIds: string[] = [];
    const insertedTracks: Track[] = [];

    for (const file of selectedFiles) {
      const fileTitle = file.name.replace(/\.[^/.]+$/, "");
      const storagePath = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/\s+/g, "-")}`;

      const { error: uploadError } = await supabase.storage
        .from("music")
        .upload(storagePath, file, { contentType: file.type || "audio/mpeg" });

      if (uploadError) {
        setStatus(uploadError.message);
        setIsUploading(false);
        return;
      }

      const { data: insertedTrack, error: insertError } = await supabase
        .from("tracks")
        .insert({
          user_id: user.id,
          title: fileTitle,
          artist: null,
          storage_path: storagePath,
          mime_type: file.type || "audio/mpeg",
          file_size: file.size,
        })
        .select("*")
        .single();

      if (insertError) {
        setStatus(insertError.message);
        setIsUploading(false);
        return;
      }

      if (insertedTrack?.id) {
        insertedIds.push(insertedTrack.id);

        insertedTracks.push({
          ...insertedTrack,
          isOfflineAvailable: false,
        } as Track);
      }
    }

    if (insertedIds.length > 0) {
      const nextPlaylists = playlists.map((playlist) =>
        playlist.id === activePlaylist.id
          ? { ...playlist, trackIds: [...playlist.trackIds, ...insertedIds] }
          : playlist
      );

      await persistPlaylists(
        nextPlaylists,
        `Added ${insertedIds.length} track${insertedIds.length === 1 ? "" : "s"} and synced.`
      );
    }

    if (insertedTracks.length > 0) {
      const insertedIdSet = new Set(insertedTracks.map((track) => track.id));
      setTracks((currentTracks) => [
        ...insertedTracks,
        ...currentTracks.filter((track) => !insertedIdSet.has(track.id)),
      ]);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsUploading(false);
  }

  function chooseTrackFile(event: ChangeEvent<HTMLInputElement>) {
    void uploadTrackFiles(event.target.files);
  }

  async function replacePlaylistCover(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];

    if (!selected || !user || !activePlaylist || isAllTracksView) {
      return;
    }

    setStatus("Updating cover art...");

    try {
      const coverBlob = await imageFileToPlaylistCoverBlob(selected);
      const storagePath = playlistCoverStoragePath(user.id, activePlaylist.id);
      const previousCoverStoragePath = activePlaylist.coverStoragePath;
      const { error: uploadError } = await supabase.storage
        .from("music")
        .upload(storagePath, coverBlob, {
          cacheControl: "31536000",
          contentType: "image/jpeg",
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: signedData, error: signedUrlError } = await supabase.storage
        .from("music")
        .createSignedUrl(storagePath, PLAYLIST_COVER_SIGNED_URL_SECONDS);

      if (signedUrlError || !signedData?.signedUrl) {
        throw new Error(signedUrlError?.message || "Could not load the saved cover art.");
      }

      const coverUrl = signedData.signedUrl;
      const nextPlaylists = playlists.map((playlist) =>
        playlist.id === activePlaylist.id
          ? { ...playlist, coverDataUrl: null, coverStoragePath: storagePath }
          : playlist
      );
      const coverSizeKb = Math.max(1, Math.round(coverBlob.size / 1024));
      const nextCoverUrlsById = {
        ...playlistCoverUrlsByIdRef.current,
        [activePlaylist.id]: coverUrl,
      };

      playlistCoverUrlsByIdRef.current = nextCoverUrlsById;
      setPlaylistCoverUrlsById(nextCoverUrlsById);

      await persistPlaylists(nextPlaylists, `Cover updated and synced (${coverSizeKb} KB).`);

      if (previousCoverStoragePath && previousCoverStoragePath !== storagePath) {
        void supabase.storage.from("music").remove([previousCoverStoragePath]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update cover art.");
    } finally {
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  function playerTrackFromTrack(track: Track, playlist?: Playlist | null) {
    const sourcePlaylistCoverUrl = playlistCoverSource(playlist, playlistCoverUrlsById);
    const activePlaylistCoverUrl = playlistCoverSource(activePlaylist, playlistCoverUrlsById);
    const isOfflineSource = Boolean(track.offlineUrl);

    return {
      id: track.id,
      title: trackMetadataById[track.id]?.title || track.title,
      artist: trackMetadataById[track.id]?.artist || track.artist || playlist?.name || activePlaylist?.name || "Unknown artist",
      coverDataUrl: trackMetadataById[track.id]?.coverDataUrl || sourcePlaylistCoverUrl || activePlaylistCoverUrl,
      audioUrl: track.offlineUrl || track.signedUrl || "",
      audioUrlExpiresAt: isOfflineSource ? null : track.signedUrlExpiresAt ?? null,
      storagePath: track.storage_path,
      sourceHref: playlist && playlist.id !== ALL_TRACKS_PLAYLIST_ID ? `/library/${playlist.id}` : "/library",
      sourceLabel: playlist?.name || "Library",
    };
  }

  async function signTracksForPlayback(inputTracks: Track[]) {
    if (!navigator.onLine) {
      return inputTracks.filter((track) => Boolean(track.offlineUrl));
    }

    const signedTrackUpdates = new Map<string, Pick<Track, "signedUrl" | "signedUrlExpiresAt">>();

    await Promise.all(
      inputTracks.map(async (track) => {
        if (track.offlineUrl || hasFreshSignedUrl(track) || !track.storage_path) {
          return;
        }

        const { data, error } = await supabase.storage
          .from("music")
          .createSignedUrl(track.storage_path, TRACK_SIGNED_URL_SECONDS);

        if (!error && data?.signedUrl) {
          signedTrackUpdates.set(track.id, {
            signedUrl: data.signedUrl,
            signedUrlExpiresAt: Date.now() + TRACK_SIGNED_URL_SECONDS * 1000,
          });
        }
      })
    );

    if (signedTrackUpdates.size > 0) {
      setTracks((currentTracks) =>
        currentTracks.map((track) => {
          const update = signedTrackUpdates.get(track.id);

          return update ? { ...track, ...update } : track;
        })
      );
    }

    return inputTracks.flatMap((track): Track[] => {
      if (track.offlineUrl || hasFreshSignedUrl(track)) {
        return [track];
      }

      const update = signedTrackUpdates.get(track.id);

      return update ? [{ ...track, ...update }] : [];
    });
  }

  function tracksForPlaylist(playlist: Playlist) {
    return playlist.trackIds
      .map((trackId) => tracksById.get(trackId))
      .filter((track): track is Track => Boolean(track));
  }

  function playableTracksForPlaylist(playlist: Playlist) {
    const playlistTracks = tracksForPlaylist(playlist);

    return navigator.onLine
      ? playlistTracks.filter((track) => track.offlineUrl || track.storage_path)
      : playlistTracks.filter((track) => track.offlineUrl);
  }

  async function playPlaylist(playlist: Playlist) {
    const playableTracks = await signTracksForPlayback(playableTracksForPlaylist(playlist));

    if (playableTracks.length === 0) {
      setStatus("No playable tracks in this playlist.");
      return;
    }

    dispatchPlayQueue(playableTracks.map((track) => playerTrackFromTrack(track, playlist)), 0);
    setOpenPlaylistMenuId(null);
  }

  async function addPlaylistToQueue(playlist: Playlist) {
    const playableTracks = await signTracksForPlayback(playableTracksForPlaylist(playlist));

    if (playableTracks.length === 0) {
      setStatus("No playable tracks to add to queue.");
      return;
    }

    dispatchAppendQueue(playableTracks.map((track) => playerTrackFromTrack(track, playlist)));
    setStatus("Playlist added to queue.");
    setOpenPlaylistMenuId(null);
  }

  async function addTrackToQueue(track: Track) {
    const displayTitle = trackMetadataById[track.id]?.title || track.title;

    if (!navigator.onLine && !track.offlineUrl) {
      setStatus("This song is not downloaded for offline playback.");
      setOpenTrackMenuId(null);
      return;
    }

    const [playableTrack] = await signTracksForPlayback([track]);
    const queuedTrack = playableTrack ? playerTrackFromTrack(playableTrack, activePlaylist) : null;

    if (!queuedTrack?.audioUrl) {
      setStatus("Could not add this song because its playback link is missing.");
      setOpenTrackMenuId(null);
      return;
    }

    dispatchAppendQueue([queuedTrack]);
    setStatus(`Added "${displayTitle}" to queue.`);
    setOpenTrackMenuId(null);
  }

  async function playTrackAtIndex(index: number) {
    if (visibleTracks.length === 0) {
      return;
    }

    const selectedTrack = visibleTracks[index];

    if (!navigator.onLine && !selectedTrack?.offlineUrl) {
      setStatus("This song is not downloaded for offline playback.");
      return;
    }

    const candidateTracks = navigator.onLine
      ? visibleTracks
      : visibleTracks.filter((track) => track.offlineUrl);
    const playableTracks = await signTracksForPlayback(candidateTracks);
    const startIndex = Math.max(0, playableTracks.findIndex((track) => track.id === selectedTrack?.id));

    if (playableTracks.length === 0 || startIndex < 0) {
      setStatus("No playable tracks are available.");
      return;
    }

    dispatchPlayQueue(playableTracks.map((track) => playerTrackFromTrack(track, activePlaylist)), startIndex);
  }

  async function playFirstTrack() {
    await playTrackAtIndex(0);
  }

  function removeTrackFromPlaylist(trackId: string) {
    if (!user || !activePlaylist || isAllTracksView) {
      return;
    }

    const nextPlaylists = playlists.map((playlist) =>
      playlist.id === activePlaylist.id
        ? { ...playlist, trackIds: playlist.trackIds.filter((currentTrackId) => currentTrackId !== trackId) }
        : playlist
    );

    persistPlaylists(nextPlaylists, "Track removed from playlist and synced.");
    setOpenTrackMenuId(null);
  }

  function removeUnavailableTracksFromPlaylist() {
    if (!user || !activePlaylist || isAllTracksView) {
      return;
    }

    const availableTrackIds = new Set(tracks.map((track) => track.id));
    const nextTrackIds = activePlaylist.trackIds.filter((trackId) => availableTrackIds.has(trackId));
    const removedCount = activePlaylist.trackIds.length - nextTrackIds.length;

    if (removedCount === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Remove ${removedCount} unavailable track reference${removedCount === 1 ? "" : "s"} from "${activePlaylist.name}"? This will not delete audio files.`
    );

    if (!confirmed) {
      return;
    }

    const nextPlaylists = playlists.map((playlist) =>
      playlist.id === activePlaylist.id ? { ...playlist, trackIds: nextTrackIds } : playlist
    );

    persistPlaylists(
      nextPlaylists,
      `${removedCount} unavailable track reference${removedCount === 1 ? "" : "s"} removed and synced.`
    );
  }

  function reorderTrack(targetTrackId: string) {
    if (isAllTracksView || !user || !activePlaylist || !draggedTrackId || draggedTrackId === targetTrackId) {
      setDraggedTrackId(null);
      return;
    }

    const currentOrder = activePlaylist.trackIds;
    const fromIndex = currentOrder.indexOf(draggedTrackId);
    const toIndex = currentOrder.indexOf(targetTrackId);

    if (fromIndex < 0 || toIndex < 0) {
      setDraggedTrackId(null);
      return;
    }

    const nextTrackIds = [...currentOrder];
    const [movedTrackId] = nextTrackIds.splice(fromIndex, 1);
    nextTrackIds.splice(toIndex, 0, movedTrackId);

    const nextPlaylists = playlists.map((playlist) =>
      playlist.id === activePlaylist.id
        ? { ...playlist, trackIds: nextTrackIds }
        : playlist
    );

    persistPlaylists(nextPlaylists, "Playlist order updated and synced.");
    setDraggedTrackId(null);
  }

  function startRenamingTrack(track: Track) {
    setRenamingTrackId(track.id);
    setRenameValue(trackMetadataById[track.id]?.title || track.title);
    setOpenTrackMenuId(null);
  }

  function saveTrackName(trackId: string) {
    if (!user) {
      return;
    }

    const nextTitle = renameValue.trim();

    if (!nextTitle) {
      return;
    }

    const nextMetadata = {
      ...trackMetadataById,
      [trackId]: {
        ...trackMetadataById[trackId],
        title: nextTitle,
      },
    };

    persistTrackMetadata(nextMetadata, "Track renamed and synced.");
    setRenamingTrackId(null);
    setRenameValue("");
  }

  async function downloadTrackOffline(track: Track) {
    if (!user) {
      return;
    }

    const [downloadableTrack] = await signTracksForPlayback([track]);

    if (!downloadableTrack?.signedUrl) {
      setStatus("Could not download this song because its playback link is missing.");
      setOpenTrackMenuId(null);
      return;
    }

    if (!("caches" in window)) {
      setStatus("Offline downloads are not supported in this browser.");
      setOpenTrackMenuId(null);
      return;
    }

    const displayTitle = trackMetadataById[track.id]?.title || track.title;
    setStatus(`Downloading "${displayTitle}" for offline playback...`);

    try {
      const response = await fetch(downloadableTrack.signedUrl);

      if (!response.ok) {
        setStatus("Download failed. Please try again.");
        return;
      }

      const cache = await caches.open(OFFLINE_AUDIO_CACHE);
      await cache.put(offlineAudioRequest(track.id), response.clone());
      saveOfflineTrackRecord(user.id, track);
      setOpenTrackMenuId(null);
      setStatus(`"${displayTitle}" is now available offline.`);
      await loadData();
    } catch {
      setStatus("Download failed. Check your connection and try again.");
    }
  }

  async function removeTrackOffline(track: Track) {
    if (!user) {
      return;
    }

    if (!("caches" in window)) {
      setStatus("Offline storage is not supported in this browser.");
      setOpenTrackMenuId(null);
      return;
    }

    const displayTitle = trackMetadataById[track.id]?.title || track.title;
    const cache = await caches.open(OFFLINE_AUDIO_CACHE);
    await cache.delete(offlineAudioRequest(track.id));
    removeOfflineTrackRecord(user.id, track.id);
    setOpenTrackMenuId(null);
    setStatus(`Removed offline copy of "${displayTitle}".`);
    await loadData();
  }

  const openPlaylistForMenu = openPlaylistMenuId
    ? playlists.find((playlist) => playlist.id === openPlaylistMenuId) || null
    : null;
  const openPlaylistMenuTracks = openPlaylistForMenu ? tracksForPlaylist(openPlaylistForMenu) : [];
  const openPlaylistMenuCover = openPlaylistForMenu
    ? playlistCoverSource(openPlaylistForMenu, playlistCoverUrlsById) ||
      trackMetadataById[openPlaylistMenuTracks[0]?.id || ""]?.coverDataUrl ||
      null
    : null;
  const openTrackForMenu = openTrackMenuId ? tracksById.get(openTrackMenuId) || null : null;
  const openTrackMenuTitle = openTrackForMenu
    ? trackMetadataById[openTrackForMenu.id]?.title || openTrackForMenu.title
    : "";
  const openTrackMenuArtist = openTrackForMenu
    ? trackMetadataById[openTrackForMenu.id]?.artist ||
      openTrackForMenu.artist ||
      activePlaylist?.name ||
      "Unknown artist"
    : "";
  const openTrackMenuCover = openTrackForMenu
    ? trackMetadataById[openTrackForMenu.id]?.coverDataUrl ||
      playlistCoverSource(activePlaylist, playlistCoverUrlsById) ||
      null
    : null;

  const playlistActionSheet = openPlaylistForMenu ? (
    <ActionSheet
      label={`${openPlaylistForMenu.name} playlist menu`}
      onClose={() => {
        setOpenPlaylistMenuId(null);
        setRenamingPlaylistId(null);
        setPlaylistRenameValue("");
      }}
    >
      <div className="flex items-center gap-4 border-b border-[var(--app-border)] pb-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[var(--app-glass)] text-[var(--app-muted)]">
          {openPlaylistMenuCover ? (
            <img src={openPlaylistMenuCover} alt="" className="h-full w-full object-cover" />
          ) : (
            <InlineIcon name="queue" className="h-8 w-8" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold text-[var(--app-text)]">{openPlaylistForMenu.name}</p>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            Playlist - {formatCount(openPlaylistMenuTracks.length)}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <ActionSheetButton icon="queue" onClick={() => void addPlaylistToQueue(openPlaylistForMenu)}>
          Add to queue
        </ActionSheetButton>

        {renamingPlaylistId === openPlaylistForMenu.id ? (
          <div className="rounded-2xl bg-[var(--app-glass)] p-3">
            <label className="block text-xs font-semibold uppercase text-[var(--app-muted)]">
              Rename playlist
            </label>
            <input
              type="text"
              value={playlistRenameValue}
              onChange={(event) => setPlaylistRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  savePlaylistName(openPlaylistForMenu.id);
                }

                if (event.key === "Escape") {
                  cancelRenamingPlaylist();
                }
              }}
              className="app-input mt-2 w-full px-3 py-2 text-sm"
              autoFocus
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => savePlaylistName(openPlaylistForMenu.id)}
                className="min-h-11 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black"
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelRenamingPlaylist}
                className="min-h-11 rounded-xl border border-[var(--app-border)] px-3 py-2 text-sm font-semibold text-[var(--app-muted)] transition hover:text-[var(--app-text)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <ActionSheetButton icon="edit" onClick={() => startRenamingPlaylist(openPlaylistForMenu)}>
            Rename
          </ActionSheetButton>
        )}

        <ActionSheetButton icon="trash" tone="danger" onClick={() => deletePlaylist(openPlaylistForMenu)}>
          Delete playlist
        </ActionSheetButton>
      </div>
    </ActionSheet>
  ) : null;

  const trackActionSheet = openTrackForMenu ? (
    <ActionSheet label={`${openTrackMenuTitle} track menu`} onClose={() => setOpenTrackMenuId(null)}>
      <div className="flex items-center gap-4 border-b border-[var(--app-border)] pb-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[var(--app-glass)] text-[var(--app-muted)]">
          {openTrackMenuCover ? (
            <img src={openTrackMenuCover} alt="" className="h-full w-full object-cover" />
          ) : (
            <InlineIcon name="play" className="h-8 w-8" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold text-[var(--app-text)]">{openTrackMenuTitle}</p>
          <p className="mt-1 truncate text-sm text-[var(--app-muted)]">{openTrackMenuArtist}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-[var(--app-glass)] p-4">
        <p className="text-xs font-semibold uppercase text-[var(--app-muted)]">Properties</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-[var(--app-muted)]">Date</dt>
          <dd className="min-w-0 truncate text-[var(--app-text)]">{formatTrackDate(openTrackForMenu.created_at) || "Unknown"}</dd>
          <dt className="text-[var(--app-muted)]">Size</dt>
          <dd className="min-w-0 truncate text-[var(--app-text)]">{formatFileSize(openTrackForMenu.file_size)}</dd>
          <dt className="text-[var(--app-muted)]">Type</dt>
          <dd className="min-w-0 truncate text-[var(--app-text)]">{openTrackForMenu.mime_type || "Unknown"}</dd>
        </dl>
      </div>

      <div className="mt-3 space-y-1">
        <ActionSheetButton icon="queue" onClick={() => void addTrackToQueue(openTrackForMenu)}>
          Add to queue
        </ActionSheetButton>
        <ActionSheetButton icon="edit" onClick={() => startRenamingTrack(openTrackForMenu)}>
          Rename
        </ActionSheetButton>
        {openTrackForMenu.isOfflineAvailable ? (
          <ActionSheetButton icon="remove" onClick={() => void removeTrackOffline(openTrackForMenu)}>
            Remove offline
          </ActionSheetButton>
        ) : (
          <ActionSheetButton
            icon="download"
            onClick={() => void downloadTrackOffline(openTrackForMenu)}
            disabled={!openTrackForMenu.storage_path}
          >
            Download offline
          </ActionSheetButton>
        )}
        {!isAllTracksView ? (
          <ActionSheetButton
            icon="remove"
            tone="danger"
            onClick={() => removeTrackFromPlaylist(openTrackForMenu.id)}
          >
            Remove from playlist
          </ActionSheetButton>
        ) : null}
      </div>
    </ActionSheet>
  ) : null;

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="app-shell app-page-enter min-h-screen px-6 py-8 pb-[calc(12rem+env(safe-area-inset-bottom))] text-[var(--app-text)]">
          <p className="text-sm text-[var(--app-muted)]">Loading...</p>
        </main>
      </>
    );
  }

  if (!user) {
    return null;
  }

  if (!playlistId) {
    return (
      <>
        <Navbar />
        <main className="app-shell min-h-screen px-6 py-8 text-[var(--app-text)]">
          <div className="app-content app-page-enter">
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-semibold">Your Library</h1>
                <p className="mt-2 text-sm text-[var(--app-muted)]">Simple playlists for your music.</p>
              </div>

              <button
                type="button"
                onClick={createPlaylist}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black transition hover:scale-[1.02] active:scale-[0.98]"
              >
                <InlineIcon name="add" />
                Add
              </button>
            </div>

            <div className="app-stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {visiblePlaylists
                .map((playlist) => {
                  const isBuiltInPlaylist = playlist.id === ALL_TRACKS_PLAYLIST_ID;
                  const availablePlaylistTracks = tracksForPlaylist(playlist);
                  const firstTrackId = availablePlaylistTracks[0]?.id;
                  const firstCover =
                    playlistCoverSource(playlist, playlistCoverUrlsById) ||
                    trackMetadataById[firstTrackId || ""]?.coverDataUrl ||
                    null;

                  return (
                    <div
                      key={playlist.id}
                      className={`app-card relative p-3 ${
                        openPlaylistMenuId === playlist.id ? "z-40" : ""
                      }`}
                    >
                      <div className="group relative">
                        <Link href={`/library/${playlist.id}`} className="block">
                          <div className="aspect-square overflow-hidden rounded-md bg-[var(--app-glass)]">
                            {firstCover ? (
                              <img src={firstCover} alt={playlist.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-sm text-[var(--app-muted)]">
                                Empty
                              </div>
                            )}
                          </div>
                        </Link>
                        <button
                          type="button"
                          onClick={() => void playPlaylist(playlist)}
                          disabled={availablePlaylistTracks.length === 0}
                          className="absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Play ${playlist.name}`}
                          title="Play playlist"
                        >
                          <InlineIcon name="play" className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-2">
                        <Link href={`/library/${playlist.id}`} className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--app-text)]">{playlist.name}</p>
                          <p className="text-xs text-[var(--app-muted)]">{formatCount(availablePlaylistTracks.length)}</p>
                        </Link>
                        {!isBuiltInPlaylist ? (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenPlaylistMenuId((current) => (current === playlist.id ? null : playlist.id));
                              setOpenTrackMenuId(null);
                              setRenamingPlaylistId(null);
                              setPlaylistRenameValue("");
                            }}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--app-muted)] transition hover:bg-white/[0.08] hover:text-[var(--app-text)]"
                            aria-label={`Open menu for ${playlist.name}`}
                            title="Playlist menu"
                          >
                            <InlineIcon name="more" className="h-5 w-5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
            </div>

            {visiblePlaylists.length === 0 ? (
              <div className="mt-8 rounded-lg border border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">
                No playlists yet.
              </div>
            ) : null}
          </div>
        </main>
        {playlistActionSheet}
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="app-shell min-h-screen px-5 py-6 pb-[calc(12rem+env(safe-area-inset-bottom))] text-[var(--app-text)] sm:px-8 sm:pb-36">
        <div className="app-content app-page-enter">
          <div className="mb-8 flex items-center justify-end gap-4">
            <p className="text-sm text-[var(--app-muted)]">{displayName}</p>
          </div>

          <div className="grid gap-10 lg:grid-cols-[minmax(280px,420px)_1fr] lg:items-start">
            <div className="mx-auto w-full max-w-64 sm:max-w-80 lg:sticky lg:top-8 lg:max-w-none">
              <label className={`group relative block aspect-square overflow-hidden rounded-[18px] bg-[var(--app-glass)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl ${
                isAllTracksView ? "cursor-default" : "cursor-pointer"
              }`}>
                {playlistCoverUrl ? (
                  <img
                    src={playlistCoverUrl}
                    alt={activePlaylist?.name || "playlist cover"}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[var(--app-glass)] text-sm text-[var(--app-muted)]">
                    No cover
                  </div>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-5 pb-5 pt-16 text-center text-sm font-medium text-white opacity-95">
                  {isAllTracksView ? "Synced tracks" : "Change cover art"}
                </span>
                {!isAllTracksView ? (
                  <input ref={coverInputRef} type="file" accept="image/*" onChange={replacePlaylistCover} className="hidden" />
                ) : null}
              </label>
            </div>

            <div className="min-w-0 space-y-5">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <p className="mb-2 truncate text-sm text-[var(--app-muted)]">
                    {displayName} - {visibleTracks.length} track{visibleTracks.length === 1 ? "" : "s"}
                  </p>
                  <h1 className="truncate text-4xl font-semibold leading-tight text-[var(--app-text)] sm:text-5xl">
                    {activePlaylist?.name || "Playlist"}
                  </h1>
                </div>

                <button
                  type="button"
                  onClick={() => void playFirstTrack()}
                  disabled={visibleTracks.length === 0}
                  aria-label="Play playlist"
                  title="Play playlist"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] text-[var(--app-text)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <InlineIcon name="play" className="h-5 w-5" />
                </button>
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  onChange={chooseTrackFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || isUploading || !user || !activePlaylist}
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--app-glass)] text-sm font-semibold text-[var(--app-text)] backdrop-blur transition hover:bg-[var(--app-glass-strong)]"
                >
                  {isUploading ? "Uploading..." : "+ Add tracks"}
                </button>
              </div>

              <div>
                {selectedTrackIdsInLibrary.length > 0 ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-[var(--app-muted)]">
                      {selectedTrackIdsInLibrary.length} selected
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTrackIds([]);
                          setLastSelectedTrackId(null);
                        }}
                        className="rounded-full border border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-muted)] hover:text-[var(--app-text)]"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteTracks(selectedTrackIdsInLibrary)}
                        disabled={isDeletingTracks}
                        className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isDeletingTracks ? "Deleting..." : `Delete ${selectedTrackIdsInLibrary.length}`}
                      </button>
                    </div>
                  </div>
                ) : null}

                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search"
                  className="app-input mb-3 w-full px-3 py-2 text-sm"
                />

                {unavailableActiveTrackCount > 0 ? (
                  <div className="mb-3 rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                    <p>
                      {unavailableActiveTrackCount} track reference{unavailableActiveTrackCount === 1 ? "" : "s"} saved in this playlist did not load from Supabase.
                    </p>
                    <button
                      type="button"
                      onClick={removeUnavailableTracksFromPlaylist}
                      className="mt-2 text-xs font-semibold text-amber-50 underline-offset-4 hover:underline"
                    >
                      Remove unavailable references
                    </button>
                  </div>
                ) : null}

                <div className="app-stagger divide-y divide-white/[0.06]">
                  {visibleTracks.map((track, index) => {
                  const displayTitle = trackMetadataById[track.id]?.title || track.title;
                  const isCurrentTrack = currentTrackId === track.id;
                  const isSelected = selectedTrackIdSet.has(track.id);

                  return (
                    <div
                        key={track.id}
                        draggable={!isAllTracksView && renamingTrackId !== track.id}
                        onDragStart={() => !isAllTracksView && setDraggedTrackId(track.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => reorderTrack(track.id)}
                        onDragEnd={() => setDraggedTrackId(null)}
                      className={`app-list-row group relative grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-xl px-2 py-3 ${
                        draggedTrackId === track.id ? "opacity-45" : ""
                      } ${
                        isCurrentTrack ? "bg-[var(--app-playing-bg)] text-[var(--app-playing-text)]" : ""
                      } ${
                        isSelected ? "bg-white/[0.08]" : ""
                      } ${
                        openTrackMenuId === track.id ? "z-30" : ""
                      }`}
                    >
                      <button
                          type="button"
                          onClick={(event) => handleTrackClick(event, track.id, index)}
                          disabled={renamingTrackId === track.id}
                        className={`text-right text-sm disabled:cursor-default ${
                          isCurrentTrack ? "text-[var(--app-playing-text)] group-hover:text-[var(--app-playing-text)]" : "text-[var(--app-muted)] group-hover:text-[var(--app-text)]"
                        }`}
                      >
                        {index + 1}
                      </button>

                        <div className="min-w-0">
                          {renamingTrackId === track.id ? (
                            <div className="flex max-w-xl gap-2">
                              <input
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    saveTrackName(track.id);
                                  }

                                  if (event.key === "Escape") {
                                    setRenamingTrackId(null);
                                    setRenameValue("");
                                  }
                                }}
                                className="app-input min-w-0 flex-1 px-3 py-1 text-sm"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => saveTrackName(track.id)}
                                className="rounded-md bg-white px-3 py-1 text-xs font-semibold text-black"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                          <button type="button" onClick={(event) => handleTrackClick(event, track.id, index)} className="block w-full text-left">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={`truncate text-sm font-semibold ${
                                isCurrentTrack ? "text-[var(--app-playing-text)]" : "text-[var(--app-text)]"
                              }`}>{displayTitle}</span>
                              {track.isOfflineAvailable ? (
                                <span className="shrink-0 rounded-full border border-green-900/60 px-2 py-0.5 text-[10px] font-medium text-green-300">
                                  Offline
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenTrackMenuId((currentTrackId) => (currentTrackId === track.id ? null : track.id));
                            setOpenPlaylistMenuId(null);
                            setRenamingPlaylistId(null);
                            setPlaylistRenameValue("");
                          }}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--app-muted)] transition hover:bg-white/[0.08] hover:text-[var(--app-text)]"
                          aria-label={`Open menu for ${displayTitle}`}
                          title="Track menu"
                        >
                          <InlineIcon name="more" className="h-5 w-5" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {visibleTracks.length === 0 ? (
                  <div className="py-12 text-center text-sm text-[var(--app-muted)]">
                    This playlist is empty.
                  </div>
                ) : null}
              </div>

              {status ? <p className="text-sm text-[var(--app-muted)]">{status}</p> : null}
            </div>
          </div>
        </div>
      </main>
      {trackActionSheet}
    </>
  );
}
