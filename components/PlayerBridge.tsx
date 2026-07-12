"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type PlayerTrack = {
  id: string;
  title: string;
  artist: string;
  coverDataUrl?: string | null;
  audioUrl: string;
};

type PlayerRequest = {
  tracks: PlayerTrack[];
  startIndex: number;
};

type PlaybackMode = "normal" | "shuffle" | "repeat-all" | "repeat-one";

const PLAY_EVENT = "music-locker:play-track";
const APPEND_EVENT = "music-locker:append-track-queue";
export const CURRENT_TRACK_EVENT = "music-locker:current-track";
const PLAYBACK_MODE_SEQUENCE: PlaybackMode[] = [
  "normal",
  "shuffle",
  "repeat-all",
  "repeat-one",
];
const APP_ICON_ARTWORK = [
  { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
];
const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
  "seekto",
  "stop",
];

function formatTime(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
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

function getMediaSession() {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return null;
  }

  return navigator.mediaSession;
}

function setMediaSessionAction(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
) {
  try {
    getMediaSession()?.setActionHandler(action, handler);
  } catch {
    // Browsers vary in which Media Session actions they expose.
  }
}

function shuffleIndexes(indexes: number[]) {
  const shuffled = [...indexes];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function buildShuffleOrder(length: number, startIndex: number) {
  if (length <= 0) {
    return [];
  }

  const safeStartIndex = Math.min(Math.max(startIndex, 0), length - 1);
  const rest = Array.from({ length }, (_, index) => index).filter(
    (index) => index !== safeStartIndex
  );

  return [safeStartIndex, ...shuffleIndexes(rest)];
}

function nextPlaybackMode(mode: PlaybackMode): PlaybackMode {
  const currentIndex = PLAYBACK_MODE_SEQUENCE.indexOf(mode);
  return PLAYBACK_MODE_SEQUENCE[(currentIndex + 1) % PLAYBACK_MODE_SEQUENCE.length];
}

function playbackModeTitle(mode: PlaybackMode): string {
  if (mode === "shuffle") {
    return "Shuffle";
  }

  if (mode === "repeat-all") {
    return "Loop queue";
  }

  if (mode === "repeat-one") {
    return "Loop current song";
  }

  return "Playback mode";
}

function playbackModeIcon(mode: PlaybackMode): "shuffle" | "repeat" | "repeatOne" {
  if (mode === "repeat-all") {
    return "repeat";
  }

  if (mode === "repeat-one") {
    return "repeatOne";
  }

  return "shuffle";
}

function PlayerIcon({
  name,
  className = "h-4 w-4",
}: {
  name:
    | "previous"
    | "play"
    | "pause"
    | "next"
    | "queue"
    | "shuffle"
    | "repeat"
    | "repeatOne"
    | "volume"
    | "chevronDown";
  className?: string;
}) {
  const paths = {
    previous: (
      <>
        <path d="M6 5v14" />
        <path d="m18 6-8 6 8 6V6Z" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: (
      <>
        <path d="M8 5v14" />
        <path d="M16 5v14" />
      </>
    ),
    next: (
      <>
        <path d="M18 5v14" />
        <path d="m6 6 8 6-8 6V6Z" />
      </>
    ),
    queue: (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h10" />
      </>
    ),
    shuffle: (
      <>
        <path d="M16 3h5v5" />
        <path d="M4 20 21 3" />
        <path d="M21 16v5h-5" />
        <path d="M15 15l6 6" />
        <path d="M4 4l5 5" />
      </>
    ),
    repeat: (
      <>
        <path d="m17 2 4 4-4 4" />
        <path d="M3 11V9a3 3 0 0 1 3-3h15" />
        <path d="m7 22-4-4 4-4" />
        <path d="M21 13v2a3 3 0 0 1-3 3H3" />
      </>
    ),
    repeatOne: (
      <>
        <path d="m17 2 4 4-4 4" />
        <path d="M3 11V9a3 3 0 0 1 3-3h15" />
        <path d="m7 22-4-4 4-4" />
        <path d="M21 13v2a3 3 0 0 1-3 3H3" />
        <text
          x="12"
          y="15"
          fill="currentColor"
          fontSize="8"
          fontWeight="700"
          stroke="none"
          textAnchor="middle"
        >
          1
        </text>
      </>
    ),
    volume: (
      <>
        <path d="M5 9v6h4l5 4V5L9 9H5Z" />
        <path d="M17 9.5a4 4 0 0 1 0 5" />
        <path d="M19.5 7a8 8 0 0 1 0 10" />
      </>
    ),
    chevronDown: <path d="m6 9 6 6 6-6" />,
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

export function dispatchPlayQueue(tracks: PlayerTrack[], startIndex: number) {
  if (tracks.length === 0) {
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
  if (tracks.length === 0) {
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

function dispatchCurrentTrack(trackId: string | null) {
  window.dispatchEvent(
    new CustomEvent(CURRENT_TRACK_EVENT, {
      detail: { trackId },
    })
  );
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  return target instanceof HTMLInputElement && ![
    "button",
    "checkbox",
    "color",
    "file",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(target.type);
}

export default function PlayerBridge() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastProgressRenderAtRef = useRef(0);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isExpandedPlayerOpen, setIsExpandedPlayerOpen] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("normal");
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);
  const [shuffleCursor, setShuffleCursor] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const track = queue[queueIndex] || null;
  const isShuffleOn = playbackMode === "shuffle";
  const isRepeatAllOn = playbackMode === "repeat-all";
  const isRepeatOneOn = playbackMode === "repeat-one";
  const shufflePosition = isShuffleOn
    ? shuffleOrder[shuffleCursor] === queueIndex
      ? shuffleCursor
      : shuffleOrder.indexOf(queueIndex)
    : queueIndex;
  const hasPreviousTrack = isShuffleOn ? shufflePosition > 0 : queueIndex > 0;
  const hasNextTrack = isShuffleOn
    ? shufflePosition >= 0 && shufflePosition < shuffleOrder.length - 1
    : queueIndex < queue.length - 1 || (isRepeatAllOn && queue.length > 1);
  const canPlayPrevious = currentTime > 3 || hasPreviousTrack || (isRepeatAllOn && queue.length > 1);
  const canPlayNext = hasNextTrack || (isRepeatOneOn && queue.length > 1);
  const scrubMax = duration > 0 ? duration : Math.max(currentTime, 0);
  const scrubValue = Math.min(currentTime, scrubMax);
  const progressPercent =
    duration > 0 ? `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%` : "0%";
  const progressRangeStyle = {
    "--player-range-progress": progressPercent,
  } as CSSProperties;

  const resetPlaybackProgress = useCallback(() => {
    setCurrentTime(0);
    setDuration(0);
    lastProgressRenderAtRef.current = 0;
  }, []);

  const seekTo = useCallback((value: number) => {
    const audio = audioRef.current;
    const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    const audioDuration =
      audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const nextTime = audioDuration > 0 ? Math.min(safeValue, audioDuration) : safeValue;

    if (audio) {
      audio.currentTime = nextTime;
    }

    lastProgressRenderAtRef.current = performance.now();
    setCurrentTime(nextTime);
  }, [duration]);

  const startTrackAt = useCallback((index: number, nextShuffleCursor?: number) => {
    const safeIndex = Math.min(Math.max(index, 0), Math.max(queue.length - 1, 0));

    setQueueIndex(safeIndex);
    resetPlaybackProgress();

    if (typeof nextShuffleCursor === "number") {
      setShuffleCursor(nextShuffleCursor);
    }

    setIsPlaying(true);
  }, [queue.length, resetPlaybackProgress]);

  const cyclePlaybackMode = useCallback(() => {
    const nextMode = nextPlaybackMode(playbackMode);

    if (nextMode === "shuffle" && queue.length > 0) {
      setShuffleOrder(buildShuffleOrder(queue.length, queueIndex));
      setShuffleCursor(0);
    }

    if (playbackMode === "shuffle" && nextMode !== "shuffle") {
      setShuffleOrder([]);
      setShuffleCursor(0);
    }

    setPlaybackMode(nextMode);
  }, [playbackMode, queue.length, queueIndex]);

  const selectQueuedTrack = useCallback((index: number) => {
    const safeIndex = Math.min(Math.max(index, 0), Math.max(queue.length - 1, 0));

    setQueueIndex(safeIndex);
    resetPlaybackProgress();

    if (isShuffleOn) {
      setShuffleOrder(buildShuffleOrder(queue.length, safeIndex));
      setShuffleCursor(0);
    }

    setIsPlaying(true);
  }, [isShuffleOn, queue.length, resetPlaybackProgress]);

  useEffect(() => {
    function handlePlay(event: Event) {
      const customEvent = event as CustomEvent<PlayerRequest>;
      const nextQueue = customEvent.detail.tracks;
      const startIndex = Math.min(Math.max(customEvent.detail.startIndex, 0), nextQueue.length - 1);

      setQueue(nextQueue);
      setQueueIndex(startIndex);
      resetPlaybackProgress();

      if (playbackMode === "shuffle") {
        setShuffleOrder(buildShuffleOrder(nextQueue.length, startIndex));
        setShuffleCursor(0);
      } else {
        setShuffleOrder([]);
        setShuffleCursor(0);
      }

      setIsPlaying(true);
    }

    window.addEventListener(PLAY_EVENT, handlePlay as EventListener);
    return () => window.removeEventListener(PLAY_EVENT, handlePlay as EventListener);
  }, [playbackMode, resetPlaybackProgress]);

  useEffect(() => {
    function handleAppend(event: Event) {
      const customEvent = event as CustomEvent<Pick<PlayerRequest, "tracks">>;
      const incomingTracks = customEvent.detail.tracks;

      setQueue((currentQueue) => {
        const nextQueue = [...currentQueue, ...incomingTracks];

        if (currentQueue.length === 0) {
          setQueueIndex(0);
          resetPlaybackProgress();
          setIsPlaying(true);

          if (playbackMode === "shuffle") {
            setShuffleOrder(buildShuffleOrder(nextQueue.length, 0));
            setShuffleCursor(0);
          }
        } else if (playbackMode === "shuffle") {
          const appendedIndexes = incomingTracks.map((_, index) => currentQueue.length + index);
          setShuffleOrder((currentOrder) => [...currentOrder, ...shuffleIndexes(appendedIndexes)]);
        }

        return nextQueue;
      });
    }

    window.addEventListener(APPEND_EVENT, handleAppend as EventListener);
    return () => window.removeEventListener(APPEND_EVENT, handleAppend as EventListener);
  }, [playbackMode, resetPlaybackProgress]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !track) {
      return;
    }

    audio.src = track.audioUrl;
    audio.currentTime = 0;
    lastProgressRenderAtRef.current = 0;
    dispatchCurrentTrack(track.id);

    const promise = audio.play();
    if (promise) {
      void promise.catch(() => setIsPlaying(false));
    }
  }, [track]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (isPlaying) {
      if (track) {
        dispatchCurrentTrack(track.id);
      }

      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying, track]);

  useEffect(() => {
    function seekBy(seconds: number) {
      const currentAudioTime = audioRef.current?.currentTime ?? currentTime;
      seekTo(currentAudioTime + seconds);
    }

    function handlePlayerKeyDown(event: globalThis.KeyboardEvent) {
      if (!track || isTextEntryTarget(event.target)) {
        return;
      }

      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        setIsPlaying((current) => !current);
        return;
      }

      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        seekBy(event.code === "ArrowLeft" ? -10 : 10);
      }
    }

    function handlePlayerKeyUp(event: globalThis.KeyboardEvent) {
      if (
        !track ||
        isTextEntryTarget(event.target) ||
        !["ArrowLeft", "ArrowRight", "Space"].includes(event.code)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("keydown", handlePlayerKeyDown, true);
    window.addEventListener("keyup", handlePlayerKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handlePlayerKeyDown, true);
      window.removeEventListener("keyup", handlePlayerKeyUp, true);
    };
  }, [currentTime, seekTo, track]);

  const playPrevious = useCallback(() => {
    const audio = audioRef.current;

    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    if (isShuffleOn) {
      const currentShuffleCursor =
        shuffleOrder[shuffleCursor] === queueIndex ? shuffleCursor : shuffleOrder.indexOf(queueIndex);

      if (currentShuffleCursor <= 0) {
        return;
      }

      const targetCursor = currentShuffleCursor - 1;
      const targetIndex = shuffleOrder[targetCursor];

      startTrackAt(targetIndex, targetCursor);
      return;
    }

    if (queueIndex <= 0) {
      if (isRepeatAllOn && queue.length > 1) {
        startTrackAt(queue.length - 1);
      }

      return;
    }

    startTrackAt(queueIndex - 1);
  }, [isRepeatAllOn, isShuffleOn, queue.length, queueIndex, shuffleCursor, shuffleOrder, startTrackAt]);

  const moveToNextTrack = useCallback(() => {
    if (queue.length === 0) {
      return false;
    }

    if (isShuffleOn) {
      const currentShuffleCursor =
        shuffleOrder[shuffleCursor] === queueIndex ? shuffleCursor : shuffleOrder.indexOf(queueIndex);

      if (currentShuffleCursor < 0 || currentShuffleCursor >= shuffleOrder.length - 1) {
        return false;
      }

      const targetCursor = currentShuffleCursor + 1;
      const targetIndex = shuffleOrder[targetCursor];

      startTrackAt(targetIndex, targetCursor);
      return true;
    }

    if (queueIndex >= queue.length - 1) {
      if (isRepeatAllOn && queue.length > 1) {
        startTrackAt(0);
        return true;
      }

      return false;
    }

    startTrackAt(queueIndex + 1);
    return true;
  }, [isRepeatAllOn, isShuffleOn, queue.length, queueIndex, shuffleCursor, shuffleOrder, startTrackAt]);

  const playNext = useCallback(() => {
    moveToNextTrack();
  }, [moveToNextTrack]);

  const handleEnded = useCallback(() => {
    if (isRepeatOneOn) {
      const audio = audioRef.current;

      if (audio) {
        audio.currentTime = 0;
        setCurrentTime(0);
        setIsPlaying(true);
        void audio.play().catch(() => setIsPlaying(false));
        return;
      }
    }

    if (moveToNextTrack()) {
      return;
    }

    setIsPlaying(false);
    dispatchCurrentTrack(null);
  }, [isRepeatOneOn, moveToNextTrack]);

  useEffect(() => {
    const mediaSession = getMediaSession();

    if (!mediaSession) {
      return;
    }

    if (!track) {
      mediaSession.metadata = null;
      mediaSession.playbackState = "none";
      MEDIA_SESSION_ACTIONS.forEach((action) => setMediaSessionAction(action, null));
      return;
    }

    if (typeof MediaMetadata !== "undefined") {
      try {
        mediaSession.metadata = new MediaMetadata({
          title: track.title || "Music Locker",
          artist: track.artist || "Unknown artist",
          album: "Music Locker",
          artwork: artworkForTrack(track),
        });
      } catch {
        mediaSession.metadata = null;
      }
    }

    setMediaSessionAction("play", () => setIsPlaying(true));
    setMediaSessionAction("pause", () => setIsPlaying(false));
    setMediaSessionAction("previoustrack", playPrevious);
    setMediaSessionAction("nexttrack", queue.length > 1 ? playNext : null);
    setMediaSessionAction("seekbackward", null);
    setMediaSessionAction("seekforward", null);
    setMediaSessionAction("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        seekTo(details.seekTime);
      }
    });
    setMediaSessionAction("stop", () => setIsPlaying(false));

    return () => {
      mediaSession.metadata = null;
      MEDIA_SESSION_ACTIONS.forEach((action) => setMediaSessionAction(action, null));
    };
  }, [playNext, playPrevious, queue.length, seekTo, track]);

  useEffect(() => {
    const mediaSession = getMediaSession();

    if (!mediaSession) {
      return;
    }

    mediaSession.playbackState = track ? (isPlaying ? "playing" : "paused") : "none";

    const audio = audioRef.current;
    const audioDuration =
      Number.isFinite(duration) && duration > 0
        ? duration
        : audio && Number.isFinite(audio.duration)
          ? audio.duration
          : 0;

    if (!track || audioDuration <= 0 || typeof mediaSession.setPositionState !== "function") {
      return;
    }

    try {
      mediaSession.setPositionState({
        duration: audioDuration,
        playbackRate: audio?.playbackRate || 1,
        position: Math.min(Math.max(0, currentTime), audioDuration),
      });
    } catch {
      // Ignore browsers that reject position state for streamed or unknown-duration audio.
    }
  }, [currentTime, duration, isPlaying, track]);

  function openExpandedPlayer() {
    if (window.matchMedia("(min-width: 640px)").matches) {
      return;
    }

    setIsExpandedPlayerOpen(true);
  }

  function collapseExpandedPlayer() {
    setIsExpandedPlayerOpen(false);
    setIsQueueOpen(false);
  }

  const renderExpandedControls = (isCompact = false) => (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={cyclePlaybackMode}
        aria-label={playbackModeTitle(playbackMode)}
        aria-pressed={playbackMode !== "normal"}
        title={playbackModeTitle(playbackMode)}
        className={`flex items-center justify-center rounded-full transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isCompact ? "h-11 w-11" : "h-12 w-12"
        } ${playbackMode !== "normal" ? "bg-white text-black" : "text-[var(--app-muted)]"}`}
      >
        <PlayerIcon name={playbackModeIcon(playbackMode)} className={isCompact ? "h-4 w-4" : "h-5 w-5"} />
      </button>

      <button
        type="button"
        onClick={playPrevious}
        disabled={!canPlayPrevious}
        aria-label="Back"
        title="Back"
        className={`flex items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isCompact ? "h-12 w-12" : "h-14 w-14"
        }`}
      >
        <PlayerIcon name="previous" className={isCompact ? "h-6 w-6" : "h-7 w-7"} />
      </button>

      <button
        type="button"
        onClick={() => setIsPlaying((current) => !current)}
        aria-label={isPlaying ? "Pause" : "Play"}
        title={isPlaying ? "Pause" : "Play"}
        className={`flex items-center justify-center rounded-full bg-white text-black shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isCompact ? "h-16 w-16" : "h-20 w-20"
        }`}
      >
        <PlayerIcon name={isPlaying ? "pause" : "play"} className={isCompact ? "h-7 w-7" : "h-8 w-8"} />
      </button>

      <button
        type="button"
        onClick={playNext}
        disabled={!canPlayNext}
        aria-label="Skip"
        title="Skip"
        className={`flex items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isCompact ? "h-12 w-12" : "h-14 w-14"
        }`}
      >
        <PlayerIcon name="next" className={isCompact ? "h-6 w-6" : "h-7 w-7"} />
      </button>

      <button
        type="button"
        onClick={() => setIsQueueOpen((current) => !current)}
        aria-label="Queue"
        aria-pressed={isQueueOpen}
        title="Queue"
        className={`flex items-center justify-center rounded-full transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isCompact ? "h-11 w-11" : "h-12 w-12"
        } ${isQueueOpen ? "bg-white text-black" : "text-[var(--app-muted)]"}`}
      >
        <PlayerIcon name="queue" className={isCompact ? "h-4 w-4" : "h-5 w-5"} />
      </button>
    </div>
  );

  const renderQueuePanel = (className: string, listClassName = "max-h-56") => (
    <div className={className} aria-label="Playback queue">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
        <div className="min-w-0">
          <p className="text-xl font-semibold text-white">Queue</p>
          <p className="mt-0.5 text-xs text-[var(--app-muted)]">
            {queue.length} track{queue.length === 1 ? "" : "s"} in queue
          </p>
        </div>
        <span className="rounded-full border border-white/[0.1] bg-white/[0.06] px-2.5 py-1 font-mono text-xs text-white">
          {queueIndex + 1}/{queue.length}
        </span>
      </div>
      <div className={`${listClassName} overflow-y-auto p-2`}>
        {queue.map((queuedTrack, index) => (
          <button
            key={`${queuedTrack.id}-${index}`}
            type="button"
            onClick={() => selectQueuedTrack(index)}
            className={`flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-white/[0.08] ${
              index === queueIndex ? "bg-white/[0.11] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" : "text-[var(--app-muted)]"
            }`}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06] font-mono text-xs text-white shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
              {queuedTrack.coverDataUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={queuedTrack.coverDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                index + 1
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold text-white">{queuedTrack.title}</span>
              <span className="block truncate text-xs text-[var(--app-muted)]">{queuedTrack.artist}</span>
            </span>
            {index === queueIndex ? (
              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase text-black">
                Now
              </span>
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center gap-1 text-[var(--app-muted)]" aria-hidden="true">
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) return;
          const now = performance.now();
          const shouldRenderProgress =
            now - lastProgressRenderAtRef.current > 250 ||
            Math.abs((duration || 0) - audio.currentTime) < 0.25;

          if (!shouldRenderProgress) {
            return;
          }

          lastProgressRenderAtRef.current = now;
          setCurrentTime(audio.currentTime);
        }}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          setDuration(audio.duration || 0);
        }}
        onEnded={handleEnded}
        hidden
      />

      {track ? (
        <>
          {isExpandedPlayerOpen ? (
            <div className="fixed inset-0 z-[300] bg-[rgba(8,8,8,0.94)] px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-white backdrop-blur-2xl sm:hidden">
              <div className="mx-auto flex h-full max-w-md flex-col">
                <div className="flex h-14 items-center justify-between">
                  <div className="h-1.5 w-12 rounded-full bg-white/20" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={collapseExpandedPlayer}
                    className="flex h-12 w-12 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                    aria-label="Collapse player"
                    title="Collapse"
                  >
                    <PlayerIcon name="chevronDown" className="h-6 w-6" />
                  </button>
                </div>

                <div className={`flex min-h-0 flex-1 flex-col ${
                  isQueueOpen ? "gap-4 overflow-hidden pb-1" : "justify-center gap-6"
                }`}>
                  {isQueueOpen ? (
                    <>
                      <div className="rounded-[28px] border border-white/[0.08] bg-[rgba(32,32,32,0.78)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                        <div className="flex min-w-0 items-center gap-3">
                          {track.coverDataUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={track.coverDataUrl}
                              alt=""
                              className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-[0_14px_36px_rgba(0,0,0,0.32)]"
                            />
                          ) : (
                            <div className="h-16 w-16 shrink-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-glass)]" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-xl font-semibold leading-tight text-white">{track.title}</p>
                            <p className="mt-1 truncate text-sm text-[var(--app-muted)]">{track.artist}</p>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2">
                          <input
                            type="range"
                            min={0}
                            max={scrubMax}
                            step={0.01}
                            value={scrubValue}
                            onInput={(event) => seekTo(Number(event.currentTarget.value))}
                            onChange={(event) => seekTo(Number(event.currentTarget.value))}
                            className="player-range h-10 w-full"
                            style={progressRangeStyle}
                            aria-label="Song position"
                          />
                          <div className="flex justify-between font-mono text-xs text-[var(--app-muted)]">
                            <span>{formatTime(currentTime)}</span>
                            <span>{formatTime(duration)}</span>
                          </div>
                        </div>

                        <div className="mt-4">
                          {renderExpandedControls(true)}
                        </div>
                      </div>

                      {renderQueuePanel(
                        "min-h-0 flex-1 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[rgba(32,32,32,0.76)] shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl",
                        "h-full max-h-none"
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mx-auto w-[78vw] max-w-[22rem]">
                        {track.coverDataUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={track.coverDataUrl}
                            alt=""
                            className="aspect-square w-full rounded-[28px] object-cover shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
                          />
                        ) : (
                          <div className="aspect-square w-full rounded-[28px] border border-[var(--app-border)] bg-[var(--app-glass)] shadow-[0_28px_90px_rgba(0,0,0,0.5)]" />
                        )}
                      </div>

                      <div className="min-w-0 text-center">
                        <p className="truncate text-2xl font-semibold leading-tight text-white">{track.title}</p>
                        <p className="mt-2 truncate text-base text-[var(--app-muted)]">{track.artist}</p>
                      </div>

                      <div className="space-y-2">
                        <input
                          type="range"
                          min={0}
                          max={scrubMax}
                          step={0.01}
                          value={scrubValue}
                          onInput={(event) => seekTo(Number(event.currentTarget.value))}
                          onChange={(event) => seekTo(Number(event.currentTarget.value))}
                          className="player-range h-10 w-full"
                          style={progressRangeStyle}
                          aria-label="Song position"
                        />
                        <div className="flex justify-between font-mono text-xs text-[var(--app-muted)]">
                          <span>{formatTime(currentTime)}</span>
                          <span>{formatTime(duration)}</span>
                        </div>
                      </div>

                      {renderExpandedControls()}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 px-3 sm:bottom-5 sm:px-4">
            {isQueueOpen && !isExpandedPlayerOpen
              ? (
                <div className="hidden sm:block">
                  {renderQueuePanel(
                    "mx-auto mb-3 max-h-80 max-w-4xl overflow-hidden rounded-3xl border border-white/[0.08] bg-[rgba(27,27,27,0.74)] shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
                  )}
                </div>
              )
              : null}

            <div
              className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-[rgba(36,36,36,0.78)] px-2 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:flex-nowrap sm:gap-3 sm:rounded-full sm:px-3"
            >
              <button
                type="button"
                onClick={openExpandedPlayer}
                aria-label={`Open player for ${track.title}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl pr-1 text-left transition active:scale-[0.995] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 sm:cursor-default sm:gap-3 sm:rounded-full"
              >
                {track.coverDataUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={track.coverDataUrl}
                    alt=""
                    className="h-11 w-11 rounded-xl object-cover sm:h-11 sm:w-11 sm:rounded-full"
                  />
                ) : (
                  <div className="h-11 w-11 rounded-xl border border-[var(--app-border)] bg-[var(--app-glass)] sm:rounded-full" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--app-text)]">{track.title}</p>
                  <p className="truncate text-xs text-[var(--app-muted)]">{track.artist}</p>
                </div>
              </button>

              <input
                data-player-action
                type="range"
                min={0}
                max={scrubMax}
                step={0.01}
                value={scrubValue}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onInput={(event) => seekTo(Number(event.currentTarget.value))}
                onChange={(event) => seekTo(Number(event.currentTarget.value))}
                className="player-range order-last h-8 w-full sm:order-none sm:flex-[1.3]"
                style={progressRangeStyle}
                aria-label="Song position"
              />

              <div className="hidden items-center gap-2 font-mono text-xs text-white sm:flex">
                <span>{formatTime(currentTime)}</span>
                <span>/</span>
                <span>{formatTime(duration)}</span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 sm:gap-1">
                <button
                  type="button"
                  onClick={playPrevious}
                  disabled={!canPlayPrevious}
                  aria-label="Back"
                  title="Back"
                  className="flex h-12 w-12 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35 sm:h-10 sm:w-10"
                >
                  <PlayerIcon name="previous" className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsPlaying((current) => !current)}
                  aria-label={isPlaying ? "Pause" : "Play"}
                  title={isPlaying ? "Pause" : "Play"}
                  className="flex h-[52px] min-h-[52px] w-[52px] min-w-[52px] items-center justify-center rounded-full bg-white text-black shadow-[0_10px_30px_rgba(0,0,0,0.28)] sm:h-10 sm:min-h-10 sm:w-10 sm:min-w-10"
                >
                  <PlayerIcon name={isPlaying ? "pause" : "play"} className="h-5 w-5 sm:h-4 sm:w-4" />
                </button>

                <button
                  type="button"
                  onClick={playNext}
                  disabled={!canPlayNext}
                  aria-label="Skip"
                  title="Skip"
                  className="flex h-12 w-12 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35 sm:h-10 sm:w-10"
                >
                  <PlayerIcon name="next" className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={cyclePlaybackMode}
                  aria-label={playbackModeTitle(playbackMode)}
                  aria-pressed={playbackMode !== "normal"}
                  title={playbackModeTitle(playbackMode)}
                  className={`hidden h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/[0.08] sm:flex ${
                    playbackMode !== "normal" ? "bg-white text-black" : "text-[var(--app-muted)]"
                  }`}
                >
                  <PlayerIcon name={playbackModeIcon(playbackMode)} />
                </button>

                <button
                  type="button"
                  onClick={() => setIsQueueOpen((current) => !current)}
                  aria-label="Queue"
                  aria-pressed={isQueueOpen}
                  title="Queue"
                  className={`hidden h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/[0.08] sm:flex ${
                    isQueueOpen ? "bg-white text-black" : "text-white"
                  }`}
                >
                  <PlayerIcon name="queue" />
                </button>

                <div className="group relative hidden sm:block">
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] focus:bg-white/[0.08]"
                    aria-label="Volume"
                    title="Volume"
                  >
                    <PlayerIcon name="volume" />
                  </button>
                  <div className="pointer-events-none absolute bottom-11 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-full border border-white/[0.08] bg-[rgba(27,27,27,0.78)] px-3 py-4 opacity-0 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(event) => setVolume(Number(event.currentTarget.value))}
                      className="h-24 w-2 accent-white [direction:rtl] [writing-mode:vertical-lr]"
                      aria-label="Volume"
                    />
                    <span className="text-[10px] text-[var(--app-muted)]">{Math.round(volume * 100)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
