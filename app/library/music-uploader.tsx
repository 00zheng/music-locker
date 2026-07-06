"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "@/lib/supabase";

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

type OfflineTrackRecord = {
  id: string;
  title: string;
  artist: string | null;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
};

type MusicUploaderProps = {
  showUploader?: boolean;
  showLibrary?: boolean;
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
  try {
    const raw = localStorage.getItem(offlineTracksKey(userId));

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
}

function writeOfflineTrackRecords(
  userId: string,
  tracks: OfflineTrackRecord[]
) {
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

  const withoutCurrentTrack = existingTracks.filter(
    (savedTrack) => savedTrack.id !== track.id
  );

  writeOfflineTrackRecords(userId, [record, ...withoutCurrentTrack]);
}

function removeOfflineTrackRecord(userId: string, trackId: string) {
  const existingTracks = readOfflineTrackRecords(userId);

  const updatedTracks = existingTracks.filter(
    (savedTrack) => savedTrack.id !== trackId
  );

  writeOfflineTrackRecords(userId, updatedTracks);
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

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export default function MusicUploader({
  showUploader = true,
  showLibrary = true,
}: MusicUploaderProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  const replaceTracks = useCallback((nextTracks: Track[]) => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));

    objectUrlsRef.current = nextTracks
      .map((track) => track.offlineUrl)
      .filter((url): url is string => Boolean(url));

    setTracks(nextTracks);
  }, []);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
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

  async function getActiveUserId() {
    if (currentUserId) {
      return currentUserId;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.user?.id ?? null;
  }

  const loadTracks = useCallback(async () => {
    setStatus("Loading your music...");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let activeUser = user;

    if (!activeUser) {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      activeUser = session?.user ?? null;
    }

    if (!activeUser) {
      setStatus("You must be signed in to view your library.");
      replaceTracks([]);
      return;
    }

    setCurrentUserId(activeUser.id);

    const { data, error } = await supabase
      .from("tracks")
      .select("*")
      .eq("user_id", activeUser.id)
      .order("created_at", { ascending: false });

    if (error) {
      const offlineOnlyTracks = readOfflineTrackRecords(activeUser.id).map(
        (track) => ({
          ...track,
          offlineOnly: true,
        })
      );

      const offlineTracksWithUrls = await attachOfflineInfo(offlineOnlyTracks);
      const availableOfflineTracks = offlineTracksWithUrls.filter(
        (track) => track.isOfflineAvailable
      );

      replaceTracks(availableOfflineTracks);

      if (availableOfflineTracks.length > 0) {
        setStatus("Offline mode: showing downloaded songs.");
      } else {
        setStatus(`Could not load tracks: ${error.message}`);
      }

      return;
    }

    const databaseTracks = (data ?? []) as Track[];

    const tracksWithSignedUrls = await Promise.all(
      databaseTracks.map(async (track) => {
        const { data: signedData, error: signedUrlError } =
          await supabase.storage
            .from("music")
            .createSignedUrl(track.storage_path, 60 * 60);

        if (signedUrlError) {
          return {
            ...track,
            signedUrl: undefined,
          };
        }

        return {
          ...track,
          signedUrl: signedData.signedUrl,
        };
      })
    );

    const tracksWithOfflineInfo = await attachOfflineInfo(tracksWithSignedUrls);

    replaceTracks(tracksWithOfflineInfo);
    setStatus("");
  }, [attachOfflineInfo, replaceTracks]);

  useEffect(() => {
    if (showLibrary) {
      loadTracks();
    }
  }, [loadTracks, showLibrary]);

  function cleanFileName(fileName: string) {
    return fileName
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9.\-_]/g, "")
      .toLowerCase();
  }

  function formatFileSize(size: number | null) {
    if (!size) return "Unknown size";

    const mb = size / 1024 / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  function isAudioFile(selectedFile: File) {
    const hasAudioMimeType = selectedFile.type.startsWith("audio/");
    const hasAudioExtension = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(
      selectedFile.name
    );

    return hasAudioMimeType || hasAudioExtension;
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setStatus("Please choose an audio file first.");
      return;
    }

    if (!isAudioFile(file)) {
      setStatus(
        "Please upload an audio file, such as MP3, WAV, M4A, OGG, or FLAC."
      );
      return;
    }

    setIsUploading(true);
    setStatus("Uploading...");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setStatus("You must be signed in before uploading.");
      setIsUploading(false);
      return;
    }

    const cleanedFileName = cleanFileName(file.name);
    const storagePath = `${user.id}/${crypto.randomUUID()}-${cleanedFileName}`;

    const finalTitle =
      title.trim() || file.name.replace(/\.[^/.]+$/, "") || "Untitled Track";

    const { error: uploadError } = await supabase.storage
      .from("music")
      .upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "audio/mpeg",
      });

    if (uploadError) {
      setStatus(`Upload failed: ${uploadError.message}`);
      setIsUploading(false);
      return;
    }

    const { error: insertError } = await supabase.from("tracks").insert({
      user_id: user.id,
      title: finalTitle,
      artist: artist.trim() || null,
      storage_path: storagePath,
      mime_type: file.type || "audio/mpeg",
      file_size: file.size,
    });

    if (insertError) {
      setStatus(
        `File uploaded, but the track was not saved to the database: ${insertError.message}`
      );
      setIsUploading(false);
      return;
    }

    setTitle("");
    setArtist("");
    setFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setIsUploading(false);
    setStatus(
      showLibrary
        ? "Upload complete."
        : "Upload complete. Go to Library to play it."
    );

    if (showLibrary) {
      await loadTracks();
    }
  }

  async function handleDownloadOffline(track: Track) {
    if (!track.signedUrl) {
      setStatus("Could not download this song because its playback link is missing.");
      return;
    }

    if (!("caches" in window)) {
      setStatus("Offline downloads are not supported in this browser.");
      return;
    }

    setStatus(`Downloading "${track.title}" for offline playback...`);

    try {
      const response = await fetch(track.signedUrl);

      if (!response.ok) {
        setStatus("Download failed. Please try again.");
        return;
      }

      const cache = await caches.open(OFFLINE_AUDIO_CACHE);
      await cache.put(offlineAudioRequest(track.id), response.clone());

      const activeUserId = await getActiveUserId();

      if (!activeUserId) {
        setStatus("Downloaded, but could not save offline metadata.");
        return;
      }

      saveOfflineTrackRecord(activeUserId, track);

      setStatus(`"${track.title}" is now available offline.`);
      await loadTracks();
    } catch {
      setStatus("Download failed. Check your connection and try again.");
    }
  }

  async function handleRemoveOffline(track: Track) {
    if (!("caches" in window)) {
      setStatus("Offline storage is not supported in this browser.");
      return;
    }

    const activeUserId = await getActiveUserId();

    setStatus(`Removing offline copy of "${track.title}"...`);

    const cache = await caches.open(OFFLINE_AUDIO_CACHE);
    await cache.delete(offlineAudioRequest(track.id));

    if (activeUserId) {
      removeOfflineTrackRecord(activeUserId, track.id);
    }

    setStatus(`Removed offline copy of "${track.title}".`);
    await loadTracks();
  }

  async function handleDelete(track: Track) {
    setStatus("Deleting track...");

    const activeUserId = await getActiveUserId();

    const { error: storageError } = await supabase.storage
      .from("music")
      .remove([track.storage_path]);

    if (storageError) {
      setStatus(`Could not delete file: ${storageError.message}`);
      return;
    }

    const { error: databaseError } = await supabase
      .from("tracks")
      .delete()
      .eq("id", track.id);

    if (databaseError) {
      setStatus(
        `File deleted, but the database record was not deleted: ${databaseError.message}`
      );
      return;
    }

    if ("caches" in window) {
      const cache = await caches.open(OFFLINE_AUDIO_CACHE);
      await cache.delete(offlineAudioRequest(track.id));
    }

    if (activeUserId) {
      removeOfflineTrackRecord(activeUserId, track.id);
    }

    setStatus("Track deleted.");
    await loadTracks();
  }

  return (
    <div
      className={
        showUploader && showLibrary
          ? "grid gap-8 lg:grid-cols-[360px_1fr]"
          : "grid gap-8"
      }
    >
      {showUploader && (
        <form
          onSubmit={handleUpload}
          className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6"
        >
          <h2 className="text-xl font-semibold">Upload a song</h2>

          <p className="mt-2 text-sm text-zinc-400">
            Add an audio file to your private Supabase music locker.
          </p>

          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm text-zinc-300">Song title</span>

              <input
                type="text"
                value={title}
                placeholder="Example: Late Night Demo"
                onChange={(event) => setTitle(event.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-violet-500"
              />
            </label>

            <label className="block">
              <span className="text-sm text-zinc-300">Artist</span>

              <input
                type="text"
                value={artist}
                placeholder="Optional"
                onChange={(event) => setArtist(event.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-violet-500"
              />
            </label>

            <label className="block">
              <span className="text-sm text-zinc-300">Audio file</span>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300"
              />
            </label>

            <button
              type="submit"
              disabled={isUploading}
              className="w-full rounded-lg bg-violet-600 px-4 py-2 font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? "Uploading..." : "Upload Song"}
            </button>

            {status && <p className="text-sm text-zinc-400">{status}</p>}
          </div>
        </form>
      )}

      {showLibrary && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Your songs</h2>

            <p className="mt-1 text-sm text-zinc-400">
              These are loaded from Supabase. Songs marked offline can play
              without internet.
            </p>

            {status && <p className="mt-2 text-sm text-zinc-400">{status}</p>}
          </div>

          {tracks.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <p className="text-zinc-400">No songs uploaded yet.</p>
            </div>
          ) : (
            tracks.map((track) => {
              const audioSource = track.offlineUrl || track.signedUrl;

              return (
                <article
                  key={track.id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
                >
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">
                          {track.title}
                        </h3>

                        {track.isOfflineAvailable && (
                          <span className="rounded-full border border-green-900/70 px-2 py-0.5 text-xs text-green-400">
                            Offline
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-zinc-400">
                        {track.artist || "Unknown artist"} ·{" "}
                        {formatFileSize(track.file_size)}
                      </p>

                      {track.offlineOnly && (
                        <p className="mt-1 text-xs text-zinc-500">
                          Offline-only view. Reconnect to sync with Supabase.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {track.isOfflineAvailable ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveOffline(track)}
                          className="rounded-lg border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
                        >
                          Remove Offline
                        </button>
                      ) : (
                        track.signedUrl && (
                          <button
                            type="button"
                            onClick={() => handleDownloadOffline(track)}
                            className="rounded-lg border border-green-900/70 px-3 py-1 text-sm text-green-400 hover:bg-green-950/40"
                          >
                            Download Offline
                          </button>
                        )
                      )}

                      {!track.offlineOnly && (
                        <button
                          type="button"
                          onClick={() => handleDelete(track)}
                          className="rounded-lg border border-red-900/60 px-3 py-1 text-sm text-red-400 hover:bg-red-950/40"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {audioSource ? (
                    <audio controls src={audioSource} className="w-full" />
                  ) : (
                    <p className="text-sm text-red-400">
                      Could not create playback link.
                    </p>
                  )}
                </article>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}