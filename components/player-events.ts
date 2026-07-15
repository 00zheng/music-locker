"use client";

export type PlayerTrack = {
  id: string;
  title: string;
  artist: string;
  coverDataUrl?: string | null;
  audioUrl: string;
  sourceHref?: string;
  sourceLabel?: string;
};

export type PlayerRequest = {
  tracks: PlayerTrack[];
  startIndex: number;
};

export const PLAY_EVENT = "music-locker:play-track";
export const APPEND_EVENT = "music-locker:append-track-queue";
export const CURRENT_TRACK_EVENT = "music-locker:current-track";

let currentTrackIdSnapshot: string | null = null;

export function dispatchPlayQueue(tracks: PlayerTrack[], startIndex: number) {
  if (tracks.length === 0 || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PlayerRequest>(PLAY_EVENT, {
      detail: {
        tracks,
        startIndex: Math.min(Math.max(startIndex, 0), tracks.length - 1),
      },
    })
  );
}

export function dispatchAppendQueue(tracks: PlayerTrack[]) {
  if (tracks.length === 0 || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<Pick<PlayerRequest, "tracks">>(APPEND_EVENT, {
      detail: {
        tracks,
      },
    })
  );
}

export function dispatchCurrentTrack(trackId: string | null) {
  currentTrackIdSnapshot = trackId;

  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(CURRENT_TRACK_EVENT, {
      detail: { trackId },
    })
  );
}

export function getCurrentTrackId() {
  return currentTrackIdSnapshot;
}
