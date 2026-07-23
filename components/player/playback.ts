import { supabase } from "@/lib/supabase";
import type { PlayerTrack } from "@/components/player-events";

export const DEFAULT_VOLUME_LEVEL = 90;
export const PREPARED_LOOKAHEAD_SIZE = 8;

const APP_ICON_ARTWORK = [
  { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
];
const TRACK_SIGNED_URL_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const VOLUME_CURVE_EXPONENT = 2;

export const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
  "seekto",
  "stop",
];

export function clampVolumeLevel(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOLUME_LEVEL;
  }

  return Math.min(100, Math.max(0, value));
}

export function volumeLevelToAudioVolume(level: number) {
  const normalizedLevel = clampVolumeLevel(level) / 100;

  return normalizedLevel ** VOLUME_CURVE_EXPONENT;
}

export function applyAudioOutputSettings(audio: HTMLAudioElement, volume: number) {
  audio.defaultMuted = false;
  audio.muted = false;
  audio.volume = Math.min(1, Math.max(0, volume));
}

function imageTypeFromSource(src: string) {
  if (!src.startsWith("data:image/")) {
    return undefined;
  }

  return src.slice("data:".length).split(";")[0] || undefined;
}

function artworkForTrack(track: PlayerTrack) {
  const coverSrc = track.coverDataUrl?.trim();

  if (!coverSrc) {
    return APP_ICON_ARTWORK;
  }

  return [
    { src: coverSrc, sizes: "512x512", type: imageTypeFromSource(coverSrc) },
    ...APP_ICON_ARTWORK,
  ];
}

export function getMediaSession() {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return null;
  }

  return navigator.mediaSession;
}

export function setMediaSessionAction(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
) {
  try {
    getMediaSession()?.setActionHandler(action, handler);
  } catch {
    // Browsers vary in which Media Session actions they expose.
  }
}

export function setMediaSessionTrackMetadata(track: PlayerTrack | null) {
  const mediaSession = getMediaSession();

  if (!mediaSession) {
    return;
  }

  if (!track || typeof MediaMetadata === "undefined") {
    mediaSession.metadata = null;
    return;
  }

  const metadata = {
    title: track.title || "Music Locker",
    artist: track.artist || "Unknown artist",
    album: "Music Locker",
  };

  try {
    // Assign the replacement atomically. Clearing first makes some car and
    // lock-screen UIs briefly drop the active media session.
    mediaSession.metadata = new MediaMetadata({
      ...metadata,
      artwork: artworkForTrack(track),
    });
  } catch {
    try {
      mediaSession.metadata = new MediaMetadata({
        ...metadata,
        artwork: APP_ICON_ARTWORK,
      });
    } catch {
      mediaSession.metadata = null;
    }
  }
}

export function clearMediaSessionPositionState() {
  const mediaSession = getMediaSession();

  if (!mediaSession || typeof mediaSession.setPositionState !== "function") {
    return;
  }

  try {
    mediaSession.setPositionState();
  } catch {
    // Some browsers expose Media Session but reject position updates.
  }
}

function isNonExpiringAudioUrl(audioUrl: string) {
  return audioUrl.startsWith("blob:") || audioUrl.startsWith("data:") || audioUrl.startsWith("/");
}

export function hasFreshAudioUrl(track: PlayerTrack) {
  const audioUrl = track.audioUrl.trim();

  if (!audioUrl) {
    return false;
  }

  if (isNonExpiringAudioUrl(audioUrl)) {
    return true;
  }

  if (!track.storagePath?.trim()) {
    return true;
  }

  return Boolean(
    track.audioUrlExpiresAt &&
      track.audioUrlExpiresAt > Date.now() + SIGNED_URL_REFRESH_WINDOW_MS
  );
}

function audioUrlToElementSrc(audioUrl: string) {
  if (typeof window === "undefined") {
    return audioUrl;
  }

  try {
    return new URL(audioUrl, window.location.href).href;
  } catch {
    return audioUrl;
  }
}

export function audioElementHasTrackSource(audio: HTMLAudioElement, track: PlayerTrack) {
  return (audio.currentSrc || audio.src) === audioUrlToElementSrc(track.audioUrl);
}

export function mergePreparedTrack(candidateTrack: PlayerTrack, preparedTrack: PlayerTrack) {
  return {
    ...candidateTrack,
    audioUrl: preparedTrack.audioUrl,
    audioUrlExpiresAt: preparedTrack.audioUrlExpiresAt ?? candidateTrack.audioUrlExpiresAt,
  };
}

export async function resolvePlayableTracks(tracks: PlayerTrack[]) {
  const playableTracks = new Map<string, PlayerTrack>();
  const tracksByStoragePath = new Map<string, PlayerTrack[]>();
  const fallbackTracks = new Map<string, PlayerTrack>();

  tracks.forEach((track) => {
    if (hasFreshAudioUrl(track)) {
      playableTracks.set(track.id, track);
      return;
    }

    const storagePath = track.storagePath?.trim();

    if (track.audioUrl.trim() && !track.audioUrlExpiresAt) {
      fallbackTracks.set(track.id, track);
    }

    if (!storagePath) {
      const fallbackTrack = fallbackTracks.get(track.id);

      if (fallbackTrack) {
        playableTracks.set(track.id, fallbackTrack);
      }
      return;
    }

    const pathTracks = tracksByStoragePath.get(storagePath) ?? [];
    pathTracks.push(track);
    tracksByStoragePath.set(storagePath, pathTracks);
  });

  if (
    tracksByStoragePath.size === 0 ||
    typeof navigator === "undefined" ||
    !navigator.onLine
  ) {
    fallbackTracks.forEach((track, trackId) => playableTracks.set(trackId, track));
    return playableTracks;
  }

  try {
    const { data, error } = await supabase.storage
      .from("music")
      .createSignedUrls([...tracksByStoragePath.keys()], TRACK_SIGNED_URL_SECONDS);

    if (!error && data) {
      const expiresAt = Date.now() + TRACK_SIGNED_URL_SECONDS * 1000;

      data.forEach(({ path, signedUrl }) => {
        if (!path || !signedUrl) {
          return;
        }

        tracksByStoragePath.get(path)?.forEach((track) => {
          playableTracks.set(track.id, {
            ...track,
            audioUrl: signedUrl,
            audioUrlExpiresAt: expiresAt,
          });
        });
      });
    }
  } catch {
    // Existing non-expiring URLs remain a safe fallback below.
  }

  fallbackTracks.forEach((track, trackId) => {
    if (!playableTracks.has(trackId)) {
      playableTracks.set(trackId, track);
    }
  });

  return playableTracks;
}

export async function resolvePlayableTrack(track: PlayerTrack) {
  const playableTracks = await resolvePlayableTracks([track]);

  return playableTracks.get(track.id) ?? null;
}

export function createAudioPreloadLink(track: PlayerTrack) {
  if (
    typeof document === "undefined" ||
    !hasFreshAudioUrl(track) ||
    track.audioUrl.startsWith("blob:") ||
    track.audioUrl.startsWith("data:")
  ) {
    return null;
  }

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "audio";
  link.href = track.audioUrl;
  document.head.append(link);

  return link;
}
