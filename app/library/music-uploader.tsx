"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
};

export default function MusicUploader() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadTracks = useCallback(async () => {
    setStatus("Loading your music...");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setStatus("You must be signed in to view your library.");
      setTracks([]);
      return;
    }

    const { data, error } = await supabase
      .from("tracks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setStatus(`Could not load tracks: ${error.message}`);
      return;
    }

    const tracksWithUrls = await Promise.all(
      (data ?? []).map(async (track) => {
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

    setTracks(tracksWithUrls);
    setStatus("");
  }, []);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

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

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setStatus("Please choose an audio file first.");
      return;
    }

    if (!isAudioFile(file)) {
      setStatus("Please upload an audio file, such as MP3, WAV, M4A, OGG, or FLAC.");
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

    setStatus("Upload complete.");
    setIsUploading(false);

    await loadTracks();
  }

  async function handleDelete(track: Track) {
    setStatus("Deleting track...");

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

    setStatus("Track deleted.");
    await loadTracks();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
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

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Your songs</h2>

          <p className="mt-1 text-sm text-zinc-400">
            These are loaded from Supabase, not mock data.
          </p>
        </div>

        {tracks.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <p className="text-zinc-400">No songs uploaded yet.</p>
          </div>
        ) : (
          tracks.map((track) => (
            <article
              key={track.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
            >
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{track.title}</h3>

                  <p className="text-sm text-zinc-400">
                    {track.artist || "Unknown artist"} ·{" "}
                    {formatFileSize(track.file_size)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(track)}
                  className="rounded-lg border border-red-900/60 px-3 py-1 text-sm text-red-400 hover:bg-red-950/40"
                >
                  Delete
                </button>
              </div>

              {track.signedUrl ? (
                <audio controls src={track.signedUrl} className="w-full" />
              ) : (
                <p className="text-sm text-red-400">
                  Could not create playback link.
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}