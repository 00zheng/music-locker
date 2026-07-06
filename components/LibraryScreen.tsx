"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
} from "@/lib/user-prefs";
import { dispatchPlayQueue } from "@/components/PlayerBridge";

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

function InlineIcon({
  name,
  className = "h-4 w-4",
}: {
  name: "play" | "folder";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [openTrackMenuId, setOpenTrackMenuId] = useState<string | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [playlistCoverUrl, setPlaylistCoverUrl] = useState<string | null>(null);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const offlineObjectUrlsRef = useRef<string[]>([]);

  const activePlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === playlistId) || null,
    [playlistId, playlists]
  );

  const activeTrackIds = useMemo(() => {
    if (!activePlaylist) {
      return [];
    }

    return activePlaylist.trackIds;
  }, [activePlaylist]);

  const visibleTracks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filteredTracks = tracks.filter((track) => {
      if (playlistId && !activeTrackIds.includes(track.id)) {
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
      (a, b) => activeTrackIds.indexOf(a.id) - activeTrackIds.indexOf(b.id)
    );
  }, [activePlaylist?.name, activeTrackIds, playlistId, searchQuery, trackMetadataById, tracks]);

  const visiblePlaylists = useMemo(
    () =>
      playlists
        .filter((playlist) => (playlist.folderId || null) === selectedFolderId)
        .sort((a, b) => a.manualOrder - b.manualOrder),
    [playlists, selectedFolderId]
  );

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

  function persistTrackMetadata(nextMetadata: TrackMetadataById, successMessage?: string) {
    setTrackMetadataById(nextMetadata);
    return persistSyncedPreferences({ trackMetadata: nextMetadata }, successMessage);
  }

  const loadData = useCallback(async () => {
    setLoading(true);

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

    setUser(currentUser);
    const { preferences } = await loadSyncedUserPreferences(supabase, currentUser.id);
    const nextPlaylists = preferences.playlists;
    const nextPlaylistFolders = preferences.playlistFolders;
    const nextTrackMetadata = preferences.trackMetadata;
    const currentPlaylist = playlistId
      ? nextPlaylists.find((playlist) => playlist.id === playlistId)
      : null;

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
      setTrackMetadataById(nextTrackMetadata);
      setPlaylistsState(nextPlaylists);
      setPlaylistFoldersState(nextPlaylistFolders);
      setPlaylistCoverUrl(currentPlaylist?.coverDataUrl || null);
      setStatus(
        availableOfflineTracks.length > 0
          ? "Offline mode: showing downloaded songs only."
          : "Offline mode: no downloaded songs available."
      );
      setLoading(false);
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
    setTrackMetadataById(nextTrackMetadata);
    setPlaylistsState(nextPlaylists);
    setPlaylistFoldersState(nextPlaylistFolders);
    setPlaylistCoverUrl(currentPlaylist?.coverDataUrl || null);
    setStatus("");
    setLoading(false);
  }, [attachOfflineInfo, playlistId, replaceTracks, router]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [loadData]);

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
  }

  async function uploadTrackFiles(fileList: FileList | null) {
    const selectedFiles = Array.from(fileList || []);

    if (!user || !activePlaylist || selectedFiles.length === 0) {
      return;
    }

    setIsUploading(true);
    setStatus(`Uploading ${selectedFiles.length} track${selectedFiles.length === 1 ? "" : "s"}...`);

    const insertedIds: string[] = [];

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
      }
    }

    if (insertedIds.length > 0) {
      const nextPlaylists = playlists.map((playlist) =>
        playlist.id === activePlaylist.id
          ? { ...playlist, trackIds: [...playlist.trackIds, ...insertedIds] }
          : playlist
      );

      await persistPlaylists(nextPlaylists);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsUploading(false);
    setStatus(`Added ${insertedIds.length} track${insertedIds.length === 1 ? "" : "s"}.`);
    await loadData();
  }

  function chooseTrackFile(event: ChangeEvent<HTMLInputElement>) {
    void uploadTrackFiles(event.target.files);
  }

  async function replacePlaylistCover(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];

    if (!selected || !user || !activePlaylist) {
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

  function playerTrackFromTrack(track: Track) {
    return {
      id: track.id,
      title: trackMetadataById[track.id]?.title || track.title,
      artist: trackMetadataById[track.id]?.artist || track.artist || "Unknown artist",
      coverDataUrl: trackMetadataById[track.id]?.coverDataUrl || activePlaylist?.coverDataUrl || null,
      audioUrl: track.offlineUrl || track.signedUrl || "",
    };
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

    dispatchPlayQueue(playableTracks.map(playerTrackFromTrack), startIndex);
  }

  function playFirstTrack() {
    playTrackAtIndex(0);
  }

  function removeTrackFromPlaylist(trackId: string) {
    if (!user || !activePlaylist) {
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

  function reorderTrack(targetTrackId: string) {
    if (!user || !activePlaylist || !draggedTrackId || draggedTrackId === targetTrackId) {
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
          <div className="mx-auto max-w-5xl">
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-semibold">Your Library</h1>
                <p className="mt-2 text-sm text-[var(--app-muted)]">Simple playlists and folders.</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="New folder"
                  className="app-input px-3 py-2 text-sm"
                />
                <button type="button" onClick={createFolder} className="rounded-md border border-[var(--app-border)] px-4 py-2 text-sm">
                  Add Folder
                </button>
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(event) => setNewPlaylistName(event.target.value)}
                  placeholder="New playlist"
                  className="app-input px-3 py-2 text-sm"
                />
                <button type="button" onClick={createPlaylist} className="app-button px-4 py-2 text-sm">
                  Add Playlist
                </button>
              </div>
            </div>

            <div className="mb-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedFolderId(null)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  selectedFolderId === null
                    ? "border-white text-white"
                    : "border-[var(--app-border)] text-[var(--app-muted)]"
                }`}
              >
                All
              </button>
              {[...playlistFolders]
                .sort((a, b) => a.manualOrder - b.manualOrder)
                .map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                      selectedFolderId === folder.id
                        ? "border-white text-white"
                        : "border-[var(--app-border)] text-[var(--app-muted)]"
                    }`}
                  >
                    <InlineIcon name="folder" className="h-4 w-4" />
                    {folder.name}
                  </button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {visiblePlaylists
                .map((playlist) => {
                  const playlistTracks = tracks.filter((track) => playlist.trackIds.includes(track.id));
                  const firstCover =
                    playlist.coverDataUrl ||
                    trackMetadataById[playlistTracks[0]?.id || ""]?.coverDataUrl ||
                    null;

                  return (
                    <div key={playlist.id} className="app-card overflow-hidden p-3">
                      <Link href={`/library/${playlist.id}`} className="group block">
                        <div className="aspect-square overflow-hidden rounded-md bg-[#151515]">
                          {firstCover ? (
                            <img src={firstCover} alt={playlist.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-[var(--app-muted)]">
                              Empty
                            </div>
                          )}
                        </div>
                        <div className="mt-3">
                          <p className="text-sm font-medium text-[var(--app-text)]">{playlist.name}</p>
                          <p className="text-xs text-[var(--app-muted)]">{formatCount(playlist.trackIds.length)}</p>
                        </div>
                      </Link>
                      <label className="mt-3 block">
                        <span className="sr-only">Move {playlist.name} to folder</span>
                        <select
                          value={playlist.folderId || ""}
                          onChange={(event) => movePlaylistToFolder(playlist.id, event.target.value || null)}
                          className="app-input w-full px-2 py-1.5 text-xs"
                        >
                          <option value="">Library</option>
                          {[...playlistFolders]
                            .sort((a, b) => a.manualOrder - b.manualOrder)
                            .map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folder.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                  );
                })}
            </div>

            {visiblePlaylists.length === 0 ? (
              <div className="mt-8 rounded-lg border border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]">
                No playlists in this folder.
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
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center justify-between gap-4">
            <Link href="/library" className="text-sm text-[var(--app-muted)]">
              Back
            </Link>
            <p className="text-sm text-[var(--app-muted)]">{user.email}</p>
          </div>

          <div className="grid gap-10 lg:grid-cols-[minmax(280px,420px)_1fr] lg:items-start">
            <div className="lg:sticky lg:top-8">
              <label className="group relative block aspect-square cursor-pointer overflow-hidden rounded-[18px] bg-[#151515] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                {playlistCoverUrl ? (
                  <img
                    src={playlistCoverUrl}
                    alt={activePlaylist?.name || "playlist cover"}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_25%_20%,#2b2b2b,transparent_32%),linear-gradient(145deg,#181818,#0c0c0c)] text-sm text-[var(--app-muted)]">
                    No cover
                  </div>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-5 pb-5 pt-16 text-center text-sm font-medium text-white opacity-95">
                  Change cover art
                </span>
                <input ref={coverInputRef} type="file" accept="image/*" onChange={replacePlaylistCover} className="hidden" />
              </label>
            </div>

            <div className="min-w-0 space-y-5">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <p className="mb-2 truncate text-sm text-[var(--app-muted)]">
                    {user.email} - {visibleTracks.length} tracks
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
                  disabled={isUploading}
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-white/[0.08] text-sm font-semibold text-white transition hover:bg-white/[0.12]"
                >
                  {isUploading ? "Uploading..." : "+ Add tracks"}
                </button>
              </div>

              <div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search"
                  className="app-input mb-3 w-full px-3 py-2 text-sm"
                />

                <div className="divide-y divide-white/[0.06]">
                  {visibleTracks.map((track, index) => {
                    const displayTitle = trackMetadataById[track.id]?.title || track.title;
                    const displayArtist = trackMetadataById[track.id]?.artist || track.artist || "Unknown artist";
                    const trackDate = formatTrackDate(track.created_at);

                    return (
                      <div
                        key={track.id}
                        draggable={renamingTrackId !== track.id}
                        onDragStart={() => setDraggedTrackId(track.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => reorderTrack(track.id)}
                        onDragEnd={() => setDraggedTrackId(null)}
                        className={`group relative grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 py-3 ${
                          draggedTrackId === track.id ? "opacity-45" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => playTrackAtIndex(index)}
                          disabled={renamingTrackId === track.id}
                          className="text-right text-sm text-[var(--app-muted)] group-hover:text-white disabled:cursor-default"
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
                            <button type="button" onClick={() => playTrackAtIndex(index)} className="block w-full text-left">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-semibold text-white">{displayTitle}</span>
                                {track.isOfflineAvailable ? (
                                  <span className="shrink-0 rounded-full border border-green-900/60 px-2 py-0.5 text-[10px] font-medium text-green-300">
                                    Offline
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          )}
                          <span className="block truncate text-xs text-[var(--app-muted)]">
                            {displayArtist}{trackDate ? ` - ${trackDate}` : ""}{track.offlineOnly ? " - downloaded only" : ""}
                          </span>
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
                          <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[#181818] py-1 text-sm shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
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
                            <button
                              type="button"
                              onClick={() => removeTrackFromPlaylist(track.id)}
                              className="block w-full px-3 py-2 text-left text-red-300 hover:bg-white/[0.08]"
                            >
                              Delete from playlist
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
