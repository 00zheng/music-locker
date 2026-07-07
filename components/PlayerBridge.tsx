"use client";

import { useEffect, useRef, useState } from "react";

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

const PLAY_EVENT = "music-locker:play-track";
const APPEND_EVENT = "music-locker:append-track-queue";
export const CURRENT_TRACK_EVENT = "music-locker:current-track";

function formatTime(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function PlayerIcon({
  name,
  className = "h-4 w-4",
}: {
  name: "previous" | "play" | "pause" | "next" | "queue" | "shuffle" | "volume";
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
    volume: (
      <>
        <path d="M5 9v6h4l5 4V5L9 9H5Z" />
        <path d="M17 9.5a4 4 0 0 1 0 5" />
        <path d="M19.5 7a8 8 0 0 1 0 10" />
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

export function dispatchPlayQueue(tracks: PlayerTrack[], startIndex: number) {
  if (tracks.length === 0) {
    return;
  }

  window.dispatchEvent(new CustomEvent<PlayerRequest>(PLAY_EVENT, {
    detail: {
      tracks,
      startIndex: Math.min(Math.max(startIndex, 0), tracks.length - 1),
    },
  }));
}

export function dispatchAppendQueue(tracks: PlayerTrack[]) {
  if (tracks.length === 0) {
    return;
  }

  window.dispatchEvent(new CustomEvent<Pick<PlayerRequest, "tracks">>(APPEND_EVENT, {
    detail: {
      tracks,
    },
  }));
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
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isShuffleOn, setIsShuffleOn] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const track = queue[queueIndex] || null;

  useEffect(() => {
    function handlePlay(event: Event) {
      const customEvent = event as CustomEvent<PlayerRequest>;
      setQueue(customEvent.detail.tracks);
      setQueueIndex(customEvent.detail.startIndex);
      setCurrentTime(0);
      setDuration(0);
      lastProgressRenderAtRef.current = 0;
      setIsPlaying(true);
    }

    window.addEventListener(PLAY_EVENT, handlePlay as EventListener);
    return () => window.removeEventListener(PLAY_EVENT, handlePlay as EventListener);
  }, []);

  useEffect(() => {
    function handleAppend(event: Event) {
      const customEvent = event as CustomEvent<Pick<PlayerRequest, "tracks">>;
      setQueue((currentQueue) => {
        if (currentQueue.length === 0) {
          setQueueIndex(0);
          setCurrentTime(0);
          setDuration(0);
          lastProgressRenderAtRef.current = 0;
          setIsPlaying(true);
        }

        return [...currentQueue, ...customEvent.detail.tracks];
      });
    }

    window.addEventListener(APPEND_EVENT, handleAppend as EventListener);
    return () => window.removeEventListener(APPEND_EVENT, handleAppend as EventListener);
  }, []);

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
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    function seekBy(seconds: number) {
      const audio = audioRef.current;

      if (!audio) {
        return;
      }

      const audioDuration = Number.isFinite(audio.duration) ? audio.duration : duration;
      const nextTime = Math.max(0, audio.currentTime + seconds);
      const clampedTime = audioDuration > 0 ? Math.min(nextTime, audioDuration) : nextTime;

      audio.currentTime = clampedTime;
      setCurrentTime(clampedTime);
    }

    function handlePlayerKeyDown(event: KeyboardEvent) {
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

    function handlePlayerKeyUp(event: KeyboardEvent) {
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
  }, [duration, track]);

  function playPrevious() {
    const audio = audioRef.current;

    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    setQueueIndex((current) => Math.max(0, current - 1));
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
  }

  function nextIndex() {
    if (!isShuffleOn || queue.length <= 1) {
      return Math.min(queue.length - 1, queueIndex + 1);
    }

    const possibleIndexes = queue
      .map((_, index) => index)
      .filter((index) => index !== queueIndex);

    return possibleIndexes[Math.floor(Math.random() * possibleIndexes.length)] ?? queueIndex;
  }

  function playNext() {
    if (queue.length === 0) {
      return;
    }

    const targetIndex = nextIndex();

    if (targetIndex === queueIndex && !isShuffleOn) {
      return;
    }

    setQueueIndex(targetIndex);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
  }

  function handleEnded() {
    if (isShuffleOn || queueIndex < queue.length - 1) {
      setQueueIndex(nextIndex());
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(true);
      return;
    }

    setIsPlaying(false);
    dispatchCurrentTrack(null);
  }

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
      <div className="fixed inset-x-0 bottom-5 z-50 px-4">
        {track && isQueueOpen ? (
          <div className="mx-auto mb-3 max-h-72 max-w-4xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[rgba(27,27,27,0.72)] shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <p className="text-sm font-semibold text-white">Queue</p>
              <p className="text-xs text-[var(--app-muted)]">{queueIndex + 1} / {queue.length}</p>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {queue.map((queuedTrack, index) => (
                <button
                  key={`${queuedTrack.id}-${index}`}
                  type="button"
                  onClick={() => {
                    setQueueIndex(index);
                    setCurrentTime(0);
                    setDuration(0);
                    setIsPlaying(true);
                  }}
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-white/[0.08] ${
                    index === queueIndex ? "bg-green-500/10 text-green-300" : "text-[var(--app-muted)]"
                  }`}
                >
                  <span className="mr-3 font-mono text-xs">{index + 1}</span>
                  {queuedTrack.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {isControlsOpen ? (
          <div className="mx-auto mb-3 flex max-w-sm items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-[rgba(27,27,27,0.72)] px-3 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:hidden">
            <button
              type="button"
              onClick={() => setIsShuffleOn((current) => !current)}
              aria-label="Shuffle"
              title="Shuffle"
              className={`flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/[0.08] ${
                isShuffleOn ? "text-white" : "text-[var(--app-muted)]"
              }`}
            >
              <PlayerIcon name="shuffle" />
            </button>
            <button
              type="button"
              onClick={() => setIsQueueOpen((current) => !current)}
              aria-label="Queue"
              title="Queue"
              className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08]"
            >
              <PlayerIcon name="queue" />
            </button>
            <label className="flex min-w-0 flex-1 items-center gap-2 text-white">
              <PlayerIcon name="volume" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                className="min-w-0 flex-1 accent-white"
                aria-label="Volume"
              />
            </label>
          </div>
        ) : null}

        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-[rgba(36,36,36,0.72)] px-2 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:flex-nowrap sm:gap-3 sm:rounded-full sm:px-3">
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                {track.coverDataUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={track.coverDataUrl} alt="cover" className="h-10 w-10 rounded-full object-cover sm:h-11 sm:w-11" />
                ) : (
                  <div className="h-10 w-10 rounded-full border border-[var(--app-border)] bg-[var(--app-glass)] sm:h-11 sm:w-11" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--app-text)]">{track.title}</p>
                  <p className="hidden truncate text-xs text-[var(--app-muted)] sm:block">{track.artist}</p>
                </div>
              </div>

              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={Math.min(currentTime, duration || 0)}
                onChange={(event) => {
                  const audio = audioRef.current;
                  const nextValue = Number(event.target.value);
                  setCurrentTime(nextValue);
                  if (audio) audio.currentTime = nextValue;
                }}
                className="order-last h-1 w-full accent-white sm:order-none sm:block sm:flex-[1.3]"
              />

              <div className="hidden items-center gap-2 font-mono text-xs text-white sm:flex">
                <span>{formatTime(currentTime)}</span>
                <span>/</span>
                <span>{formatTime(duration)}</span>
              </div>

              <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                <button
                  type="button"
                  onClick={playPrevious}
                  disabled={queueIndex === 0 && currentTime <= 3}
                  aria-label="Back"
                  title="Back"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:w-10"
                >
                  <PlayerIcon name="previous" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsPlaying((current) => !current)}
                  aria-label={isPlaying ? "Pause" : "Play"}
                  title={isPlaying ? "Pause" : "Play"}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black"
                >
                  <PlayerIcon name={isPlaying ? "pause" : "play"} className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={playNext}
                  disabled={!isShuffleOn && queueIndex >= queue.length - 1}
                  aria-label="Skip"
                  title="Skip"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:w-10"
                >
                  <PlayerIcon name="next" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsShuffleOn((current) => !current)}
                  aria-label="Shuffle"
                  title="Shuffle"
                  className={`hidden h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/[0.08] sm:flex sm:h-10 sm:w-10 ${
                    isShuffleOn ? "text-white" : "text-[var(--app-muted)]"
                  }`}
                >
                  <PlayerIcon name="shuffle" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsQueueOpen((current) => !current)}
                  aria-label="Queue"
                  title="Queue"
                  className="hidden h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] sm:flex sm:h-10 sm:w-10"
                >
                  <PlayerIcon name="queue" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsControlsOpen((current) => !current)}
                  aria-label="More player controls"
                  title="More controls"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] sm:hidden"
                >
                  <span aria-hidden="true" className="text-xl leading-none">...</span>
                </button>

                <div className="group relative hidden sm:block">
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/[0.08] focus:bg-white/[0.08] sm:h-10 sm:w-10"
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
                      onChange={(event) => setVolume(Number(event.target.value))}
                      className="h-24 w-2 accent-white [direction:rtl] [writing-mode:vertical-lr]"
                    />
                    <span className="text-[10px] text-[var(--app-muted)]">{Math.round(volume * 100)}</span>
                  </div>
                </div>
              </div>
            </>
        </div>
      </div>
      ) : null}
    </>
  );
}
