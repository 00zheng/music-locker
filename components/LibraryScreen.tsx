"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import {
  loadSyncedUserPreferences,
  saveSyncedUserPreferences,
  type PlaylistFolder,
  type Playlist,
  type SyncedUserPreferences,
  type TrackMetadataById,
  type UserProfilePreferences,
} from "@/lib/user-prefs";
import {
  CURRENT_TRACK_EVENT,
  dispatchAppendQueue,
  dispatchPlayQueue,
} from "@/components/PlayerBridge";

type Track = {
  id: string;
  title: string;
  artist: string | null;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  signedUrl?: string;
  offlineUrl?: string;
  isOfflineAvailable?: boolean;
  offlineOnly?: boolean;
};

type Props = {
  playlistId?: string;
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

type LoadDataOptions = {
  showLoading?: boolean;
  clearStatus?: boolean;
};

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

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
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

function InlineIcon({
  name,
  className = "h-4 w-4",
}: {
  name: "play" | "folder" | "add" | "back";
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
      ) : name === "add" ? (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
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

export default function LibraryScreen({ playlistId }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylistsState] = useState<Playlist[]>([]);
  const [playlistFolders, setPlaylistFoldersState] = useState<PlaylistFolder[]>([]);
  const [trackMetadataById, setTrackMetadataById] = useState<TrackMetadataById>({});
  const [profile, setProfile] = useState<UserProfilePreferences>({
    username: "",
    bio: "",
    avatarDataUrl: null,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [addKind, setAddKind] = useState<"playlist" | "folder" | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [openTrackMenuId, setOpenTrackMenuId] = useState<string | null>(null);
  const [openPlaylistMenuId, setOpenPlaylistMenuId] = useState<string | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [playlistCoverUrl, setPlaylistCoverUrl] = useState<string | null>(null);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [draggedPlaylistId, setDraggedPlaylistId] = useState<string | null>(null);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [lastSelectedTrackId, setLastSelectedTrackId] = useState<string | null>(null);
  const [isDeletingTracks, setIsDeletingTracks] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const offlineObjectUrlsRef = useRef<string[]>([]);
  const isLoadingDataRef = useRef(false);

  const allTracksPlaylist = useMemo<Playlist>(
    () => ({
      id: ALL_TRACKS_PLAYLIST_ID,
      name: "All tracks",
      trackIds: tracks.map((track) => track.id),
      manualOrder: -1,
      createdAt: "",
      coverDataUrl: null,
      folderId: null,
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
    () => {
      const folderPlaylists = playlists
        .filter((playlist) => (playlist.folderId || null) === selectedFolderId)
        .sort((a, b) => a.manualOrder - b.manualOrder);

      return folderPlaylists;
    },
    [playlists, selectedFolderId]
  );

  const visibleFolders = useMemo(
    () => [...playlistFolders].sort((a, b) => a.manualOrder - b.manualOrder),
    [playlistFolders]
  );

  const selectedFolder = useMemo(
    () => playlistFolders.find((folder) => folder.id === selectedFolderId) || null,
    [playlistFolders, selectedFolderId]
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
  const displayName = profile.username.trim() || user?.email || "Music Locker";

  const replaceTracks = useCallback((nextTracks: Track[]) => {
    offlineObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    offlineObjectUrlsRef.current = nextTracks
      .map((track) => track.offlineUrl)
      .filter((url): url is string => Boolean(url));
    setTracks(nextTracks);
  }, []);

  useEffect(() => {
    return () => {
      offlineObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    function handleCurrentTrack(event: Event) {
      const customEvent = event as CustomEvent<{ trackId: string | null }>;
      setCurrentTrackId(customEvent.detail.trackId);
    }

    window.addEventListener(CURRENT_TRACK_EVENT, handleCurrentTrack as EventListener);
    return () => window.removeEventListener(CURRENT_TRACK_EVENT, handleCurrentTrack as EventListener);
  }, []);

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

  const applySyncedPreferences = useCallback((preferences: SyncedUserPreferences) => {
    const currentPlaylist = playlistId
      ? preferences.playlists.find((playlist) => playlist.id === playlistId)
      : null;

    setTrackMetadataById(preferences.trackMetadata);
    setProfile(preferences.profile);
    setPlaylistsState(preferences.playlists);
    setPlaylistFoldersState(preferences.playlistFolders);
    setPlaylistCoverUrl(currentPlaylist?.coverDataUrl || null);
  }, [playlistId]);

  function persistSyncedPreferences(
    value: Partial<SyncedUserPreferences>,
    successMessage?: string
  ) {
    if (!user) {
      return Promise.resolve();
    }

    return saveSyncedUserPreferences(supabase, user.id, value).then(({ error }) => {
      if (error) {
        setStatus(`Saved on this device. Cloud sync failed: ${error.message}`);
        return;
      }

      if (successMessage) {
        setStatus(successMessage);
      }
    });
  }

  function persistPlaylists(nextPlaylists: Playlist[], successMessage?: string) {
    setPlaylistsState(nextPlaylists);
    return persistSyncedPreferences({ playlists: nextPlaylists }, successMessage);
  }

  function persistPlaylistFolders(nextFolders: PlaylistFolder[], successMessage?: string) {
    setPlaylistFoldersState(nextFolders);
    return persistSyncedPreferences({ playlistFolders: nextFolders }, successMessage);
  }

  function persistPlaylistsAndFolders(
    nextPlaylists: Playlist[],
    nextFolders: PlaylistFolder[],
    successMessage?: string
  ) {
    setPlaylistsState(nextPlaylists);
    setPlaylistFoldersState(nextFolders);
    return persistSyncedPreferences(
      { playlists: nextPlaylists, playlistFolders: nextFolders },
      successMessage
    );
  }

  function persistTrackMetadata(nextMetadata: TrackMetadataById, successMessage?: string) {
    setTrackMetadataById(nextMetadata);
    return persistSyncedPreferences({ trackMetadata: nextMetadata }, successMessage);
  }

  const loadData = useCallback(async (options: LoadDataOptions = {}) => {
    if (isLoadingDataRef.current) {
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
      const { preferences } = await loadSyncedUserPreferences(supabase, currentUser.id);

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
        applySyncedPreferences(preferences);
        setStatus(
          availableOfflineTracks.length > 0
            ? "Offline mode: showing downloaded songs only."
            : "Offline mode: no downloaded songs available."
        );
        return;
      }

      const tracksWithUrls = await Promise.all(
        (data || []).map(async (track) => {
          const { data: signedData, error: signedUrlError } = await supabase.storage
            .from("music")
            .createSignedUrl(track.storage_path, 60 * 60);

          return {
            ...track,
            signedUrl: signedUrlError ? undefined : signedData?.signedUrl,
          } as Track;
        })
      );
      const tracksWithOfflineInfo = await attachOfflineInfo(tracksWithUrls);

      replaceTracks(tracksWithOfflineInfo);
      applySyncedPreferences(preferences);

      if (clearStatus) {
        setStatus("");
      }
    } finally {
      isLoadingDataRef.current = false;
      setLoading(false);
    }
  }, [applySyncedPreferences, attachOfflineInfo, replaceTracks, router]);

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
      if (isRefreshingPreferences || !navigator.onLine) {
        return;
      }

      isRefreshingPreferences = true;

      try {
        const { preferences } = await loadSyncedUserPreferences(supabase, userId);
        applySyncedPreferences(preferences);
      } finally {
        isRefreshingPreferences = false;
      }
    }

    function refreshLibrary() {
      if (!navigator.onLine) {
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

    playTrackAtIndex(index);
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

  async function createPlaylist() {
    if (!user) {
      return;
    }

    const name = newPlaylistName.trim();
    if (!name) {
      return;
    }

    const nextPlaylists = [
      ...playlists,
      {
        id: crypto.randomUUID(),
        name,
        trackIds: [],
        manualOrder: playlists.length,
        createdAt: new Date().toISOString(),
        coverDataUrl: null,
        folderId: selectedFolderId,
      },
    ];

    persistPlaylists(nextPlaylists, "Playlist created and synced.");
    setNewPlaylistName("");
    setAddKind(null);
    setIsAddMenuOpen(false);
  }

  function createFolder() {
    if (!user) {
      return;
    }

    const name = newFolderName.trim();

    if (!name) {
      return;
    }

    const nextFolders = [
      ...playlistFolders,
      {
        id: crypto.randomUUID(),
        name,
        manualOrder: playlistFolders.length,
        createdAt: new Date().toISOString(),
      },
    ];

    persistPlaylistFolders(nextFolders, "Folder created and synced.");
    setNewFolderName("");
    setAddKind(null);
    setIsAddMenuOpen(false);
  }

  function groupPlaylistsIntoFolder(targetPlaylistId: string) {
    if (!user || !draggedPlaylistId || draggedPlaylistId === targetPlaylistId) {
      setDraggedPlaylistId(null);
      return;
    }

    const sourcePlaylist = playlists.find((playlist) => playlist.id === draggedPlaylistId);
    const targetPlaylist = playlists.find((playlist) => playlist.id === targetPlaylistId);

    if (!sourcePlaylist || !targetPlaylist) {
      setDraggedPlaylistId(null);
      return;
    }

    const existingFolderId = targetPlaylist.folderId || sourcePlaylist.folderId || null;
    const folderId = existingFolderId || crypto.randomUUID();
    const nextFolders = existingFolderId
      ? playlistFolders
      : [
          ...playlistFolders,
          {
            id: folderId,
            name: `${targetPlaylist.name} folder`,
            manualOrder: playlistFolders.length,
            createdAt: new Date().toISOString(),
          },
        ];
    const nextPlaylists = playlists.map((playlist) =>
      playlist.id === sourcePlaylist.id || playlist.id === targetPlaylist.id
        ? { ...playlist, folderId }
        : playlist
    );

    persistPlaylistsAndFolders(nextPlaylists, nextFolders, "Folder created from playlists and synced.");
    setSelectedFolderId(folderId);
    setDraggedPlaylistId(null);
  }

  function movePlaylistToFolder(targetPlaylistId: string, folderId: string | null) {
    if (!user) {
      return;
    }

    const nextPlaylists = playlists.map((playlist) =>
      playlist.id === targetPlaylistId ? { ...playlist, folderId } : playlist
    );

    persistPlaylists(
      nextPlaylists,
      folderId ? "Playlist moved to folder and synced." : "Playlist moved to library and synced."
    );
    setOpenPlaylistMenuId(null);
  }

  function deleteFolder(folderId: string) {
    if (!user) {
      return;
    }

    const nextFolders = playlistFolders.filter((folder) => folder.id !== folderId);
    const nextPlaylists = playlists.map((playlist) =>
      playlist.folderId === folderId ? { ...playlist, folderId: null } : playlist
    );

    persistPlaylistsAndFolders(nextPlaylists, nextFolders, "Folder deleted. Playlists moved to library.");
    setSelectedFolderId(null);
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

    persistPlaylists(nextPlaylists, "Playlist deleted and synced.");
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

        const { data: signedData, error: signedUrlError } = await supabase.storage
          .from("music")
          .createSignedUrl(insertedTrack.storage_path, 60 * 60);

        insertedTracks.push({
          ...insertedTrack,
          signedUrl: signedUrlError ? undefined : signedData?.signedUrl,
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

    const dataUrl = await fileToDataUrl(selected);
    const nextPlaylists = playlists.map((playlist) =>
      playlist.id === activePlaylist.id
        ? { ...playlist, coverDataUrl: dataUrl }
        : playlist
    );

    persistPlaylists(nextPlaylists, "Cover updated and synced.");
    setPlaylistCoverUrl(dataUrl);
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  function playerTrackFromTrack(track: Track, playlist?: Playlist | null) {
    return {
      id: track.id,
      title: trackMetadataById[track.id]?.title || track.title,
      artist: trackMetadataById[track.id]?.artist || track.artist || "Unknown artist",
      coverDataUrl: trackMetadataById[track.id]?.coverDataUrl || playlist?.coverDataUrl || activePlaylist?.coverDataUrl || null,
      audioUrl: track.offlineUrl || track.signedUrl || "",
    };
  }

  function tracksForPlaylist(playlist: Playlist) {
    return playlist.trackIds
      .map((trackId) => tracksById.get(trackId))
      .filter((track): track is Track => Boolean(track));
  }

  function playableTracksForPlaylist(playlist: Playlist) {
    const playlistTracks = tracksForPlaylist(playlist);

    return navigator.onLine
      ? playlistTracks.filter((track) => track.signedUrl || track.offlineUrl)
      : playlistTracks.filter((track) => track.offlineUrl);
  }

  function playPlaylist(playlist: Playlist) {
    const playableTracks = playableTracksForPlaylist(playlist);

    if (playableTracks.length === 0) {
      setStatus("No playable tracks in this playlist.");
      return;
    }

    dispatchPlayQueue(playableTracks.map((track) => playerTrackFromTrack(track, playlist)), 0);
    setOpenPlaylistMenuId(null);
  }

  function addPlaylistToQueue(playlist: Playlist) {
    const playableTracks = playableTracksForPlaylist(playlist);

    if (playableTracks.length === 0) {
      setStatus("No playable tracks to add to queue.");
      return;
    }

    dispatchAppendQueue(playableTracks.map((track) => playerTrackFromTrack(track, playlist)));
    setStatus("Playlist added to queue.");
    setOpenPlaylistMenuId(null);
  }

  function playTrackAtIndex(index: number) {
    if (visibleTracks.length === 0) {
      return;
    }

    const selectedTrack = visibleTracks[index];

    if (!navigator.onLine && !selectedTrack?.offlineUrl) {
      setStatus("This song is not downloaded for offline playback.");
      return;
    }

    const playableTracks = navigator.onLine
      ? visibleTracks
      : visibleTracks.filter((track) => track.offlineUrl);
    const startIndex = Math.max(0, playableTracks.findIndex((track) => track.id === selectedTrack?.id));

    dispatchPlayQueue(playableTracks.map((track) => playerTrackFromTrack(track, activePlaylist)), startIndex);
  }

  function playFirstTrack() {
    playTrackAtIndex(0);
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

  async function shareTrack(track: Track) {
    const trackTitle = trackMetadataById[track.id]?.title || track.title;
    const trackArtist = trackMetadataById[track.id]?.artist || track.artist || "Unknown artist";
    const shareText = `${trackTitle} by ${trackArtist}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: trackTitle, text: shareText });
        setStatus("Track shared.");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        setStatus("Track info copied.");
      } else {
        setStatus(shareText);
      }
    } catch {
      setStatus("Share canceled.");
    } finally {
      setOpenTrackMenuId(null);
    }
  }

  async function downloadTrackOffline(track: Track) {
    if (!user) {
      return;
    }

    if (!track.signedUrl) {
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
      const response = await fetch(track.signedUrl);

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

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="app-shell min-h-screen px-6 py-8 text-[var(--app-text)]">
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
          <div className="app-content">
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-semibold">Your Library</h1>
                <p className="mt-2 text-sm text-[var(--app-muted)]">Simple playlists and folders.</p>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsAddMenuOpen((current) => !current)}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black"
                >
                  <InlineIcon name="add" />
                  Add
                </button>
                {isAddMenuOpen ? (
                  <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-[var(--app-border)] bg-[rgba(24,24,24,0.78)] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAddKind("playlist")}
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          addKind === "playlist" ? "border-white text-white" : "border-[var(--app-border)] text-[var(--app-muted)]"
                        }`}
                      >
                        Playlist
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddKind("folder")}
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          addKind === "folder" ? "border-white text-white" : "border-[var(--app-border)] text-[var(--app-muted)]"
                        }`}
                      >
                        Folder
                      </button>
                    </div>

                    {addKind === "playlist" ? (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={newPlaylistName}
                          onChange={(event) => setNewPlaylistName(event.target.value)}
                          placeholder="Playlist name"
                          className="app-input min-w-0 flex-1 px-3 py-2 text-sm"
                          autoFocus
                        />
                        <button type="button" onClick={createPlaylist} className="app-button px-3 py-2 text-sm">
                          Save
                        </button>
                      </div>
                    ) : null}

                    {addKind === "folder" ? (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={newFolderName}
                          onChange={(event) => setNewFolderName(event.target.value)}
                          placeholder="Folder name"
                          className="app-input min-w-0 flex-1 px-3 py-2 text-sm"
                          autoFocus
                        />
                        <button type="button" onClick={createFolder} className="app-button px-3 py-2 text-sm">
                          Save
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {selectedFolder ? (
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(null)}
                    className="rounded-full border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-muted)] hover:text-white"
                  >
                    Back
                  </button>
                  <div>
                    <h2 className="text-xl font-semibold text-white">{selectedFolder.name}</h2>
                    <p className="text-sm text-[var(--app-muted)]">
                      {formatCount(playlists.filter((playlist) => playlist.folderId === selectedFolder.id).length)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteFolder(selectedFolder.id)}
                  className="rounded-full border border-red-400/30 px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/10"
                >
                  Delete folder
                </button>
              </div>
            ) : null}

            {!selectedFolderId && visibleFolders.length > 0 ? (
              <div className="mb-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                {visibleFolders.map((folder) => {
                  const folderPlaylists = playlists.filter((playlist) => playlist.folderId === folder.id);
                  const collageCovers = folderPlaylists
                    .map((playlist) => {
                      const firstTrackId = playlist.trackIds.find((trackId) => tracksById.has(trackId));

                      return (
                        playlist.coverDataUrl ||
                        trackMetadataById[firstTrackId || ""]?.coverDataUrl ||
                        null
                      );
                    })
                    .filter((cover): cover is string => Boolean(cover))
                    .slice(0, 4);

                  return (
                    <div key={folder.id} className="group">
                      <button
                        type="button"
                        onClick={() => setSelectedFolderId(folder.id)}
                        className="grid aspect-square w-full grid-cols-2 gap-1 overflow-hidden rounded-[18px] bg-[var(--app-glass)] p-2 text-left backdrop-blur transition hover:bg-[var(--app-glass-strong)]"
                      >
                        {Array.from({ length: 4 }).map((_, index) =>
                          collageCovers[index] ? (
                            <img
                              key={`${folder.id}-${index}`}
                              src={collageCovers[index]}
                              alt=""
                              className="h-full w-full rounded-md object-cover"
                            />
                          ) : (
                            <span
                              key={`${folder.id}-${index}`}
                              className="rounded-md bg-white/[0.06]"
                            />
                          )
                        )}
                      </button>
                      <div className="mt-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setSelectedFolderId(folder.id)}
                            className="block truncate text-left text-sm font-semibold uppercase tracking-wide text-white"
                          >
                            {folder.name}
                          </button>
                          <p className="text-sm text-[var(--app-muted)]">{formatCount(folderPlaylists.length)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {visiblePlaylists
                .map((playlist) => {
                  const isBuiltInPlaylist = playlist.id === ALL_TRACKS_PLAYLIST_ID;
                  const availablePlaylistTracks = tracksForPlaylist(playlist);
                  const firstTrackId = availablePlaylistTracks[0]?.id;
                  const firstCover =
                    playlist.coverDataUrl ||
                    trackMetadataById[firstTrackId || ""]?.coverDataUrl ||
                    null;

                  return (
                    <div
                      key={playlist.id}
                      draggable={!isBuiltInPlaylist}
                      onDragStart={() => !isBuiltInPlaylist && setDraggedPlaylistId(playlist.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => !isBuiltInPlaylist && groupPlaylistsIntoFolder(playlist.id)}
                      onDragEnd={() => setDraggedPlaylistId(null)}
                      className={`app-card relative overflow-hidden p-3 ${
                        draggedPlaylistId === playlist.id ? "opacity-45" : ""
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
                          onClick={() => playPlaylist(playlist)}
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
                            onClick={() => setOpenPlaylistMenuId((current) => (current === playlist.id ? null : playlist.id))}
                            className="rounded-full px-2 text-lg leading-none text-[var(--app-muted)] transition hover:bg-white/[0.08] hover:text-white"
                            aria-label={`Open menu for ${playlist.name}`}
                          >
                            ...
                          </button>
                        ) : null}
                      </div>

                      {openPlaylistMenuId === playlist.id && !isBuiltInPlaylist ? (
                        <div className="absolute right-2 top-2 z-30 w-56 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[rgba(24,24,24,0.86)] p-2 text-sm shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                          <button
                            type="button"
                            onClick={() => addPlaylistToQueue(playlist)}
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[var(--app-text)] hover:bg-white/[0.08]"
                          >
                            <span aria-hidden="true">+</span>
                            Add to queue
                          </button>
                          <label className="block px-3 py-2">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                              Move
                            </span>
                            <select
                              value={playlist.folderId || ""}
                              onChange={(event) => movePlaylistToFolder(playlist.id, event.target.value || null)}
                              className="app-input w-full px-2 py-1.5 text-xs"
                            >
                              <option value="">Library</option>
                              {visibleFolders.map((folder) => (
                                <option key={folder.id} value={folder.id}>
                                  {folder.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => deletePlaylist(playlist)}
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-red-300 hover:bg-white/[0.08]"
                          >
                            Delete playlist
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
            </div>

            {visiblePlaylists.length === 0 && (selectedFolderId || visibleFolders.length === 0) ? (
              <div className="mt-8 rounded-lg border border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">
                {selectedFolderId ? "No playlists in this folder." : "No playlists yet."}
              </div>
            ) : null}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="app-shell min-h-screen px-5 py-6 pb-32 text-[var(--app-text)] sm:px-8">
        <div className="app-content">
          <div className="mb-8 flex items-center justify-between gap-4">
            <Link
              href="/library"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--app-border)] text-[var(--app-muted)] transition hover:bg-white/[0.08] hover:text-white"
              aria-label="Back to library"
              title="Back to library"
            >
              <InlineIcon name="back" />
            </Link>
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
                  <h1 className="truncate text-4xl font-semibold leading-tight text-white sm:text-5xl">
                    {activePlaylist?.name || "Playlist"}
                  </h1>
                </div>

                <button
                  type="button"
                  onClick={playFirstTrack}
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
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--app-glass)] text-sm font-semibold text-white backdrop-blur transition hover:bg-[var(--app-glass-strong)]"
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
                        className="rounded-full border border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-muted)] hover:text-white"
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

                <div className="divide-y divide-white/[0.06]">
                  {visibleTracks.map((track, index) => {
                  const displayTitle = trackMetadataById[track.id]?.title || track.title;
                  const displayArtist = trackMetadataById[track.id]?.artist || track.artist || "Unknown artist";
                  const trackDate = formatTrackDate(track.created_at);
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
                      className={`group relative grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-xl px-2 py-3 ${
                        draggedTrackId === track.id ? "opacity-45" : ""
                      } ${
                        isCurrentTrack ? "bg-green-500/10 text-green-300" : ""
                      } ${
                        isSelected ? "bg-white/[0.08]" : ""
                      }`}
                    >
                      <button
                          type="button"
                          onClick={(event) => handleTrackClick(event, track.id, index)}
                          disabled={renamingTrackId === track.id}
                        className={`text-right text-sm group-hover:text-white disabled:cursor-default ${
                          isCurrentTrack ? "text-green-300" : "text-[var(--app-muted)]"
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
                                isCurrentTrack ? "text-green-300" : "text-white"
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
                          onClick={() => setOpenTrackMenuId((currentTrackId) => (currentTrackId === track.id ? null : track.id))}
                          className="rounded-full px-3 py-1 text-lg leading-none text-[var(--app-muted)] transition hover:bg-white/[0.08] hover:text-white"
                          aria-label={`Open menu for ${displayTitle}`}
                        >
                          ...
                        </button>

                        {openTrackMenuId === track.id ? (
                          <div className="absolute right-0 top-10 z-20 w-56 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[rgba(24,24,24,0.86)] py-1 text-sm shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur">
                            <div className="border-b border-white/[0.08] px-3 py-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Properties</p>
                              <p className="mt-1 truncate text-xs text-[var(--app-muted)]">Artist: {displayArtist}</p>
                              <p className="truncate text-xs text-[var(--app-muted)]">Date: {trackDate || "Unknown"}</p>
                              <p className="truncate text-xs text-[var(--app-muted)]">Size: {formatFileSize(track.file_size)}</p>
                              <p className="truncate text-xs text-[var(--app-muted)]">Type: {track.mime_type || "Unknown"}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => startRenamingTrack(track)}
                              className="block w-full px-3 py-2 text-left text-[var(--app-text)] hover:bg-white/[0.08]"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => void shareTrack(track)}
                              className="block w-full px-3 py-2 text-left text-[var(--app-text)] hover:bg-white/[0.08]"
                            >
                              Share
                            </button>
                            {track.isOfflineAvailable ? (
                              <button
                                type="button"
                                onClick={() => void removeTrackOffline(track)}
                                className="block w-full px-3 py-2 text-left text-[var(--app-text)] hover:bg-white/[0.08]"
                              >
                                Remove offline
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void downloadTrackOffline(track)}
                                disabled={!track.signedUrl}
                                className="block w-full px-3 py-2 text-left text-[var(--app-text)] hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Download offline
                              </button>
                            )}
                            {!isAllTracksView ? (
                              <button
                                type="button"
                                onClick={() => removeTrackFromPlaylist(track.id)}
                                className="block w-full px-3 py-2 text-left text-red-300 hover:bg-white/[0.08]"
                              >
                                Remove from playlist
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void deleteTracks([track.id])}
                              disabled={isDeletingTracks}
                              className="block w-full px-3 py-2 text-left text-red-300 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Delete track
                            </button>
                          </div>
                        ) : null}
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
    </>
  );
}
