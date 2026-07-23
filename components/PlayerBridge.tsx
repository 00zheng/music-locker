"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  APPEND_EVENT,
  PLAY_EVENT,
  dispatchCurrentTrack,
  type PlayerRequest,
  type PlayerTrack,
} from "@/components/player-events";
import {
  DEFAULT_VOLUME_LEVEL,
  MEDIA_SESSION_ACTIONS,
  PREPARED_LOOKAHEAD_SIZE,
  applyAudioOutputSettings,
  audioElementHasTrackSource,
  clampVolumeLevel,
  clearMediaSessionPositionState,
  createAudioPreloadLink,
  getMediaSession,
  hasFreshAudioUrl,
  mergePreparedTrack,
  resolvePlayableTrack,
  resolvePlayableTracks,
  setMediaSessionAction,
  setMediaSessionTrackMetadata,
  volumeLevelToAudioVolume,
} from "@/components/player/playback";

type RepeatMode = "none" | "all" | "one";
type QueueSource = "current" | "manual" | "context";
type SortableQueueSource = "manual" | "context";

type QueueEntry = {
  entryId: string;
  track: PlayerTrack;
};

type QueueDisplayItem = {
  key: string;
  source: QueueSource;
  index: number;
  track: PlayerTrack;
};

type QueueDragTarget = {
  source: SortableQueueSource;
  index: number;
};

type QueuePressState = {
  item: QueueDisplayItem;
  pointerId: number;
  startX: number;
  startY: number;
  currentY: number;
  target: HTMLElement;
};

type QueueDragState = {
  key: string;
  source: SortableQueueSource;
  index: number;
  pointerId: number;
  rowLeft: number;
  rowWidth: number;
  rowHeight: number;
  offsetY: number;
  currentY: number;
  track: PlayerTrack;
};

function formatTime(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function shuffleIndexes(indexes: number[]) {
  const shuffled = [...indexes];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function sequentialIndexes(length: number) {
  return Array.from({ length }, (_, index) => index);
}

function shuffleItems<T>(items: T[]) {
  return shuffleIndexes(sequentialIndexes(items.length)).map((index) => items[index]);
}

function shuffleTracks(tracks: PlayerTrack[]) {
  return shuffleItems(tracks);
}

function moveQueueItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);

  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function repeatModeTitle(mode: RepeatMode): string {
  if (mode === "all") {
    return "Loop queue";
  }

  if (mode === "one") {
    return "Loop current song";
  }

  return "Loop off";
}

function repeatModeIcon(mode: RepeatMode): "repeat" | "repeatOne" {
  if (mode === "one") {
    return "repeatOne";
  }

  return "repeat";
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
    | "chevronUp"
    | "chevronDown"
    | "external"
    | "minusCircle";
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
    chevronUp: <path d="m6 15 6-6 6 6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    external: (
      <>
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </>
    ),
    minusCircle: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12h8" />
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
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastProgressRenderAtRef = useRef(0);
  const queueScrollRef = useRef<HTMLDivElement | null>(null);
  const queueItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const queueEntryCounterRef = useRef(0);
  const queueLongPressTimerRef = useRef<number | null>(null);
  const queuePressRef = useRef<QueuePressState | null>(null);
  const queueDragRef = useRef<QueueDragState | null>(null);
  const queueDragTargetRef = useRef<HTMLElement | null>(null);
  const queueAutoScrollFrameRef = useRef<number | null>(null);
  const queueItemRectsBeforeReorderRef = useRef<Map<string, DOMRect> | null>(null);
  const queueReorderLockedRef = useRef(false);
  const displayedQueueItemsRef = useRef<QueueDisplayItem[]>([]);
  const suppressQueueClickRef = useRef(false);
  const bodyUserSelectBeforeDragRef = useRef<string | null>(null);
  const queueTouchActionBeforeDragRef = useRef<string | null>(null);
  const queueOverflowYBeforeDragRef = useRef<string | null>(null);
  const queueTouchMoveBlockerActiveRef = useRef(false);
  const playRetryTimeoutRef = useRef<number | null>(null);
  const playRequestIdRef = useRef(0);
  const sourceRequestIdRef = useRef(0);
  const sourceTransitionRef = useRef(false);
  const wantsPlaybackRef = useRef(false);
  const endedHandledRef = useRef(false);
  const audioVolumeRef = useRef(volumeLevelToAudioVolume(DEFAULT_VOLUME_LEVEL));
  const currentTrackRef = useRef<PlayerTrack | null>(null);
  const manualQueueRef = useRef<QueueEntry[]>([]);
  const contextQueueRef = useRef<QueueEntry[]>([]);
  const contextCycleRef = useRef<PlayerTrack[]>([]);
  const historyRef = useRef<PlayerTrack[]>([]);
  const repeatModeRef = useRef<RepeatMode>("none");
  const isShuffleOnRef = useRef(false);
  const preloadLinkRef = useRef<HTMLLinkElement | null>(null);
  const preloadRequestIdRef = useRef(0);
  const preparedTracksRef = useRef<Map<string, PlayerTrack>>(new Map());
  const playbackFailureTrackIdsRef = useRef<Set<string>>(new Set());
  const handleAudioSourceFailureRef = useRef<() => void>(() => {});
  const playPreviousRef = useRef<() => void>(() => {});
  const playNextRef = useRef<() => void>(() => {});
  const seekToRef = useRef<(value: number) => void>(() => {});
  const [currentTrack, setCurrentTrack] = useState<PlayerTrack | null>(null);
  const [manualQueue, setManualQueue] = useState<QueueEntry[]>([]);
  const [contextQueue, setContextQueue] = useState<QueueEntry[]>([]);
  const [contextCycle, setContextCycle] = useState<PlayerTrack[]>([]);
  const [history, setHistory] = useState<PlayerTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isExpandedPlayerOpen, setIsExpandedPlayerOpen] = useState(false);
  const [isShuffleOn, setIsShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("none");
  const [openQueueMenuKey, setOpenQueueMenuKey] = useState<string | null>(null);
  const [queueMenuPosition, setQueueMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [queueDragState, setQueueDragState] = useState<QueueDragState | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(DEFAULT_VOLUME_LEVEL);
  const createQueueEntry = useCallback((queuedTrack: PlayerTrack): QueueEntry => {
    const entryNumber = queueEntryCounterRef.current;

    queueEntryCounterRef.current += 1;

    return {
      entryId: `queue-${entryNumber}-${queuedTrack.id}`,
      track: queuedTrack,
    };
  }, []);
  const createQueueEntries = useCallback((tracks: PlayerTrack[]) => (
    tracks.map((queuedTrack) => createQueueEntry(queuedTrack))
  ), [createQueueEntry]);
  const track = currentTrack;
  const isRepeatAllOn = repeatMode === "all";
  const isRepeatOneOn = repeatMode === "one";
  const displayedQueueItems: QueueDisplayItem[] = useMemo(() => {
    if (isRepeatOneOn && track) {
      return [{ key: "current", source: "current", index: 0, track }];
    }

    return [
      ...(track ? [{ key: "current", source: "current" as const, index: 0, track }] : []),
      ...manualQueue.map((queuedEntry, index) => ({
        key: queuedEntry.entryId,
        source: "manual" as const,
        index,
        track: queuedEntry.track,
      })),
      ...contextQueue.map((queuedEntry, index) => ({
        key: queuedEntry.entryId,
        source: "context" as const,
        index,
        track: queuedEntry.track,
      })),
    ];
  }, [contextQueue, isRepeatOneOn, manualQueue, track]);
  const openQueueMenuItem = useMemo(() => (
    openQueueMenuKey
      ? displayedQueueItems.find((item) => item.key === openQueueMenuKey) ?? null
      : null
  ), [displayedQueueItems, openQueueMenuKey]);
  const canPlayPrevious = currentTime > 3 || history.length > 0;
  const canPlayNext =
    isRepeatOneOn ||
    manualQueue.length > 0 ||
    contextQueue.length > 0 ||
    (isRepeatAllOn && contextCycle.length > 0);
  const preparedLookaheadTracks = useMemo(() => {
    if (isRepeatOneOn) {
      return [];
    }

    const seenTrackIds = new Set<string>();
    const nextTracks: PlayerTrack[] = [];
    const addTrack = (queuedTrack: PlayerTrack | null | undefined) => {
      if (!queuedTrack || seenTrackIds.has(queuedTrack.id)) {
        return;
      }

      seenTrackIds.add(queuedTrack.id);
      nextTracks.push(queuedTrack);
    };

    manualQueue.forEach((queuedEntry) => addTrack(queuedEntry.track));
    contextQueue.forEach((queuedEntry) => addTrack(queuedEntry.track));

    if (isRepeatAllOn) {
      contextCycle.forEach(addTrack);
    }

    return nextTracks.slice(0, PREPARED_LOOKAHEAD_SIZE);
  }, [contextCycle, contextQueue, isRepeatAllOn, isRepeatOneOn, manualQueue]);
  const nextPreloadTrack = preparedLookaheadTracks[0] ?? null;
  const scrubMax = duration > 0 ? duration : Math.max(currentTime, 0);
  const scrubValue = Math.min(currentTime, scrubMax);
  const progressPercent =
    duration > 0 ? `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%` : "0%";
  const progressRangeStyle = {
    "--player-range-progress": progressPercent,
  } as CSSProperties;
  const audioVolume = volumeLevelToAudioVolume(volumeLevel);

  useEffect(() => {
    displayedQueueItemsRef.current = displayedQueueItems;
  }, [displayedQueueItems]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    manualQueueRef.current = manualQueue;
  }, [manualQueue]);

  useEffect(() => {
    contextQueueRef.current = contextQueue;
  }, [contextQueue]);

  useEffect(() => {
    contextCycleRef.current = contextCycle;
  }, [contextCycle]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  useEffect(() => {
    isShuffleOnRef.current = isShuffleOn;
  }, [isShuffleOn]);

  const resetPlaybackProgress = useCallback(() => {
    setCurrentTime(0);
    setDuration(0);
    lastProgressRenderAtRef.current = 0;
    clearMediaSessionPositionState();
  }, []);

  const clearPlayRetryTimeout = useCallback(() => {
    if (playRetryTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(playRetryTimeoutRef.current);
    playRetryTimeoutRef.current = null;
  }, []);

  const cancelPendingAudioPlay = useCallback(() => {
    playRequestIdRef.current += 1;
    clearPlayRetryTimeout();
  }, [clearPlayRetryTimeout]);

  const clearAudioPreload = useCallback(() => {
    preloadRequestIdRef.current += 1;
    preloadLinkRef.current?.remove();
    preloadLinkRef.current = null;
  }, []);

  const takePreparedTrack = useCallback((candidateTrack: PlayerTrack) => {
    const preparedTrack = preparedTracksRef.current.get(candidateTrack.id);

    if (!preparedTrack) {
      return candidateTrack;
    }

    if (!hasFreshAudioUrl(preparedTrack)) {
      preparedTracksRef.current.delete(candidateTrack.id);
      return candidateTrack;
    }

    return mergePreparedTrack(candidateTrack, preparedTrack);
  }, []);

  const requestAudioPlay = useCallback((audio: HTMLAudioElement) => {
    const requestId = playRequestIdRef.current + 1;

    playRequestIdRef.current = requestId;
    wantsPlaybackRef.current = true;
    clearPlayRetryTimeout();

    const play = (attempt: number) => {
      if (
        playRequestIdRef.current !== requestId ||
        audioRef.current !== audio ||
        !wantsPlaybackRef.current ||
        !audio.src
      ) {
        return;
      }

      void audio.play().catch((error) => {
        if (
          playRequestIdRef.current !== requestId ||
          audioRef.current !== audio ||
          !wantsPlaybackRef.current
        ) {
          return;
        }

        if (error instanceof Error && error.name === "AbortError" && attempt < 2) {
          playRetryTimeoutRef.current = window.setTimeout(() => play(attempt + 1), 150);
          return;
        }

        sourceTransitionRef.current = false;
        wantsPlaybackRef.current = false;
        setIsPlaying(false);
      });
    };

    play(0);
  }, [clearPlayRetryTimeout]);

  useEffect(() => () => {
    sourceRequestIdRef.current += 1;
    cancelPendingAudioPlay();
    clearAudioPreload();
  }, [cancelPendingAudioPlay, clearAudioPreload]);

  const loadPlayableTrack = useCallback((audio: HTMLAudioElement, playableTrack: PlayerTrack) => {
    sourceTransitionRef.current = true;
    clearMediaSessionPositionState();
    lastProgressRenderAtRef.current = 0;
    endedHandledRef.current = false;
    applyAudioOutputSettings(audio, audioVolumeRef.current);

    if (!audioElementHasTrackSource(audio, playableTrack)) {
      audio.src = playableTrack.audioUrl;
      audio.load();
    }

    try {
      audio.currentTime = 0;
    } catch {
      // Some mobile browsers reject seeking while a new source is still attaching.
    }

    setCurrentTime(0);
    dispatchCurrentTrack(playableTrack.id);
    requestAudioPlay(audio);
  }, [requestAudioPlay]);

  const playTrackOnCurrentAudio = useCallback((playbackTrack: PlayerTrack) => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const sourceRequestId = sourceRequestIdRef.current + 1;
    sourceRequestIdRef.current = sourceRequestId;

    if (hasFreshAudioUrl(playbackTrack)) {
      loadPlayableTrack(audio, playbackTrack);
      return;
    }

    const requestedTrackId = playbackTrack.id;

    void resolvePlayableTrack(playbackTrack).then((playableTrack) => {
      if (
        sourceRequestIdRef.current !== sourceRequestId ||
        audioRef.current !== audio ||
        currentTrackRef.current?.id !== requestedTrackId
      ) {
        return;
      }

      if (!playableTrack) {
        handleAudioSourceFailureRef.current();
        return;
      }

      if (hasFreshAudioUrl(playableTrack)) {
        preparedTracksRef.current.set(playableTrack.id, playableTrack);
      }

      currentTrackRef.current = playableTrack;
      setCurrentTrack(playableTrack);
      loadPlayableTrack(audio, playableTrack);
    });
  }, [loadPlayableTrack]);

  const restartCurrentAudio = useCallback(() => {
    const audio = audioRef.current;
    const activeTrack = currentTrackRef.current;

    if (!audio || !activeTrack) {
      return false;
    }

    audio.currentTime = 0;
    endedHandledRef.current = false;
    lastProgressRenderAtRef.current = 0;
    setCurrentTime(0);
    dispatchCurrentTrack(activeTrack.id);
    requestAudioPlay(audio);

    return true;
  }, [requestAudioPlay]);

  const seekTo = useCallback((value: number) => {
    const audio = audioRef.current;
    const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    const audioDuration =
      audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const nextTime = audioDuration > 0 ? Math.min(safeValue, audioDuration) : safeValue;

    if (audio) {
      audio.currentTime = nextTime;
    }

    if (audioDuration <= 0 || nextTime < audioDuration - 0.5) {
      endedHandledRef.current = false;
    }

    lastProgressRenderAtRef.current = performance.now();
    setCurrentTime(nextTime);
  }, [duration]);

  const closeQueueMenu = useCallback(() => {
    setOpenQueueMenuKey(null);
    setQueueMenuPosition(null);
  }, []);

  const setQueueItemElement = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) {
      queueItemRefs.current.set(key, node);
      return;
    }

    queueItemRefs.current.delete(key);
  }, []);

  const captureQueueItemRects = useCallback(() => {
    const nextRects = new Map<string, DOMRect>();

    queueItemRefs.current.forEach((node, key) => {
      nextRects.set(key, node.getBoundingClientRect());
    });

    queueItemRectsBeforeReorderRef.current = nextRects;
  }, []);

  useLayoutEffect(() => {
    const previousRects = queueItemRectsBeforeReorderRef.current;

    if (!previousRects) {
      queueReorderLockedRef.current = false;
      return;
    }

    queueItemRectsBeforeReorderRef.current = null;
    queueReorderLockedRef.current = false;

    queueItemRefs.current.forEach((node, key) => {
      if (key === queueDragState?.key) {
        return;
      }

      const previousRect = previousRects.get(key);

      if (!previousRect) {
        return;
      }

      const nextRect = node.getBoundingClientRect();
      const deltaY = previousRect.top - nextRect.top;

      if (Math.abs(deltaY) < 1) {
        return;
      }

      node.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        }
      );
    });
  }, [displayedQueueItems, queueDragState?.key]);

  const startTrack = useCallback((nextTrack: PlayerTrack, skippedTracks: PlayerTrack[] = []) => {
    const playbackTrack = takePreparedTrack(nextTrack);
    const activeTrack = currentTrackRef.current;
    const nextHistory = [
      ...historyRef.current,
      ...(activeTrack ? [activeTrack] : []),
      ...skippedTracks,
    ];

    historyRef.current = nextHistory;
    currentTrackRef.current = playbackTrack;
    setHistory(nextHistory);
    setCurrentTrack(playbackTrack);
    resetPlaybackProgress();
    setIsPlaying(true);
    closeQueueMenu();
    playTrackOnCurrentAudio(playbackTrack);
  }, [closeQueueMenu, playTrackOnCurrentAudio, resetPlaybackProgress, takePreparedTrack]);

  const toggleShuffleMode = useCallback(() => {
    if (isShuffleOnRef.current) {
      isShuffleOnRef.current = false;
      setIsShuffleOn(false);
      return;
    }

    const nextContextQueue = shuffleItems(contextQueueRef.current);

    contextQueueRef.current = nextContextQueue;
    setContextQueue(nextContextQueue);
    isShuffleOnRef.current = true;
    setIsShuffleOn(true);
    closeQueueMenu();
  }, [closeQueueMenu]);

  const cycleRepeatMode = useCallback(() => {
    const currentMode = repeatModeRef.current;
    const nextMode = currentMode === "all" ? "one" : currentMode === "one" ? "none" : "all";

    repeatModeRef.current = nextMode;
    setRepeatMode(nextMode);
    closeQueueMenu();
  }, [closeQueueMenu]);

  const selectQueuedItem = useCallback((item: QueueDisplayItem) => {
    if (item.source === "current") {
      closeQueueMenu();
      return;
    }

    if (item.source === "manual") {
      const currentManualQueue = manualQueueRef.current;
      const selectedEntry = currentManualQueue[item.index];

      if (!selectedEntry) {
        return;
      }

      startTrack(
        selectedEntry.track,
        currentManualQueue.slice(0, item.index).map((queuedEntry) => queuedEntry.track)
      );
      const nextManualQueue = currentManualQueue.slice(item.index + 1);

      manualQueueRef.current = nextManualQueue;
      setManualQueue(nextManualQueue);
      return;
    }

    const currentManualQueue = manualQueueRef.current;
    const currentContextQueue = contextQueueRef.current;
    const selectedEntry = currentContextQueue[item.index];

    if (!selectedEntry) {
      return;
    }

    startTrack(selectedEntry.track, [
      ...currentManualQueue.map((queuedEntry) => queuedEntry.track),
      ...currentContextQueue.slice(0, item.index).map((queuedEntry) => queuedEntry.track),
    ]);
    const nextContextQueue = currentContextQueue.slice(item.index + 1);

    manualQueueRef.current = [];
    contextQueueRef.current = nextContextQueue;
    setManualQueue([]);
    setContextQueue(nextContextQueue);
  }, [closeQueueMenu, startTrack]);

  useEffect(() => {
    function handlePlay(event: Event) {
      const customEvent = event as CustomEvent<PlayerRequest>;
      const sourceTracks = customEvent.detail.tracks;

      if (sourceTracks.length === 0) {
        return;
      }

      const startIndex = Math.min(Math.max(customEvent.detail.startIndex, 0), sourceTracks.length - 1);
      const nextTrack = takePreparedTrack(sourceTracks[startIndex]);
      const nextContextQueue = sourceTracks.slice(startIndex + 1);
      const nextContextQueueEntries = createQueueEntries(
        isShuffleOnRef.current ? shuffleTracks(nextContextQueue) : nextContextQueue
      );

      currentTrackRef.current = nextTrack;
      manualQueueRef.current = [];
      contextQueueRef.current = nextContextQueueEntries;
      contextCycleRef.current = sourceTracks;
      historyRef.current = [];
      setCurrentTrack(nextTrack);
      setManualQueue([]);
      setContextQueue(nextContextQueueEntries);
      setContextCycle(sourceTracks);
      setHistory([]);
      playbackFailureTrackIdsRef.current.clear();
      resetPlaybackProgress();
      closeQueueMenu();
      setIsPlaying(true);
      playTrackOnCurrentAudio(nextTrack);
    }

    window.addEventListener(PLAY_EVENT, handlePlay as EventListener);
    return () => window.removeEventListener(PLAY_EVENT, handlePlay as EventListener);
  }, [closeQueueMenu, createQueueEntries, playTrackOnCurrentAudio, resetPlaybackProgress, takePreparedTrack]);

  useEffect(() => {
    function handleAppend(event: Event) {
      const customEvent = event as CustomEvent<Pick<PlayerRequest, "tracks">>;
      const incomingTracks = customEvent.detail.tracks;

      if (incomingTracks.length === 0) {
        return;
      }

      if (!currentTrackRef.current) {
        const nextTrack = takePreparedTrack(incomingTracks[0]);
        const nextManualQueue = createQueueEntries(incomingTracks.slice(1));

        currentTrackRef.current = nextTrack;
        manualQueueRef.current = nextManualQueue;
        contextQueueRef.current = [];
        contextCycleRef.current = [];
        historyRef.current = [];
        setCurrentTrack(nextTrack);
        setManualQueue(nextManualQueue);
        setContextQueue([]);
        setContextCycle([]);
        setHistory([]);
        resetPlaybackProgress();
        closeQueueMenu();
        setIsPlaying(true);
        playTrackOnCurrentAudio(nextTrack);
        return;
      }

      const nextManualQueue = [
        ...manualQueueRef.current,
        ...createQueueEntries(incomingTracks),
      ];

      manualQueueRef.current = nextManualQueue;
      setManualQueue(nextManualQueue);
    }

    window.addEventListener(APPEND_EVENT, handleAppend as EventListener);
    return () => window.removeEventListener(APPEND_EVENT, handleAppend as EventListener);
  }, [closeQueueMenu, createQueueEntries, playTrackOnCurrentAudio, resetPlaybackProgress, takePreparedTrack]);

  useEffect(() => {
    const audio = audioRef.current;

    audioVolumeRef.current = audioVolume;

    if (!audio) {
      return;
    }

    applyAudioOutputSettings(audio, audioVolume);
  }, [audioVolume]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.loop = isRepeatOneOn;

    return () => {
      audio.loop = false;
    };
  }, [isRepeatOneOn]);

  useEffect(() => {
    if (!nextPreloadTrack) {
      preparedTracksRef.current.clear();
      clearAudioPreload();
      return;
    }

    const requestId = preloadRequestIdRef.current + 1;
    preloadRequestIdRef.current = requestId;
    const lookaheadTrackIds = new Set(preparedLookaheadTracks.map((preparedTrack) => preparedTrack.id));

    preloadLinkRef.current?.remove();
    preloadLinkRef.current = null;

    preparedTracksRef.current.forEach((_, trackId) => {
      if (!lookaheadTrackIds.has(trackId)) {
        preparedTracksRef.current.delete(trackId);
      }
    });

    void resolvePlayableTracks(preparedLookaheadTracks).then((playableTracks) => {
      if (preloadRequestIdRef.current !== requestId) {
        return;
      }

      playableTracks.forEach((playableTrack, trackId) => {
        preparedTracksRef.current.set(trackId, playableTrack);
      });

      const playableNextTrack = playableTracks.get(nextPreloadTrack.id);

      if (playableNextTrack) {
        preloadLinkRef.current = createAudioPreloadLink(playableNextTrack);
      }
    });
  }, [clearAudioPreload, nextPreloadTrack, preparedLookaheadTracks]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (isPlaying) {
      wantsPlaybackRef.current = true;

      if (currentTrackRef.current) {
        dispatchCurrentTrack(currentTrackRef.current.id);
      }

      requestAudioPlay(audio);
    } else {
      wantsPlaybackRef.current = false;
      cancelPendingAudioPlay();
      audio.pause();
    }
  }, [cancelPendingAudioPlay, isPlaying, requestAudioPlay]);

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

    const currentHistory = historyRef.current;
    const previousTrack = currentHistory[currentHistory.length - 1];

    if (!previousTrack) {
      return;
    }

    const playbackTrack = takePreparedTrack(previousTrack);
    const nextHistory = currentHistory.slice(0, -1);

    historyRef.current = nextHistory;
    currentTrackRef.current = playbackTrack;
    setHistory(nextHistory);
    setCurrentTrack(playbackTrack);
    resetPlaybackProgress();
    closeQueueMenu();
    setIsPlaying(true);
    playTrackOnCurrentAudio(playbackTrack);
  }, [closeQueueMenu, playTrackOnCurrentAudio, resetPlaybackProgress, takePreparedTrack]);

  const moveToNextTrack = useCallback(() => {
    if (!currentTrackRef.current) {
      return false;
    }

    if (repeatModeRef.current === "one") {
      return restartCurrentAudio();
    }

    const currentManualQueue = manualQueueRef.current;
    const nextManualEntry = currentManualQueue[0];

    if (nextManualEntry) {
      const nextManualQueue = currentManualQueue.slice(1);

      manualQueueRef.current = nextManualQueue;
      setManualQueue(nextManualQueue);
      startTrack(nextManualEntry.track);
      return true;
    }

    const currentContextQueue = contextQueueRef.current;
    const nextContextEntry = currentContextQueue[0];

    if (nextContextEntry) {
      const nextContextQueue = currentContextQueue.slice(1);

      contextQueueRef.current = nextContextQueue;
      setContextQueue(nextContextQueue);
      startTrack(nextContextEntry.track);
      return true;
    }

    const currentContextCycle = contextCycleRef.current;

    if (repeatModeRef.current === "all" && currentContextCycle.length > 0) {
      const nextCycle = isShuffleOnRef.current ? shuffleTracks(currentContextCycle) : currentContextCycle;
      const nextTrack = nextCycle[0];

      if (!nextTrack) {
        return false;
      }

      const nextContextQueue = createQueueEntries(nextCycle.slice(1));

      contextQueueRef.current = nextContextQueue;
      setContextQueue(nextContextQueue);
      startTrack(nextTrack);
      return true;
    }

    return false;
  }, [createQueueEntries, restartCurrentAudio, startTrack]);

  const playNext = useCallback(() => {
    moveToNextTrack();
  }, [moveToNextTrack]);

  const handleEnded = useCallback(() => {
    if (endedHandledRef.current) {
      return;
    }

    endedHandledRef.current = true;
    cancelPendingAudioPlay();

    if (moveToNextTrack()) {
      return;
    }

    wantsPlaybackRef.current = false;
    sourceTransitionRef.current = false;
    setIsPlaying(false);
    dispatchCurrentTrack(null);
    clearMediaSessionPositionState();
  }, [cancelPendingAudioPlay, moveToNextTrack]);

  const handleAudioSourceFailure = useCallback(() => {
    const failedTrackId = currentTrackRef.current?.id;

    if (failedTrackId) {
      playbackFailureTrackIdsRef.current.add(failedTrackId);
    }

    cancelPendingAudioPlay();

    const failedTrackIds = playbackFailureTrackIdsRef.current;
    const hasQueuedFallback =
      manualQueueRef.current.some((queuedEntry) => !failedTrackIds.has(queuedEntry.track.id)) ||
      contextQueueRef.current.some((queuedEntry) => !failedTrackIds.has(queuedEntry.track.id));

    if (hasQueuedFallback && moveToNextTrack()) {
      return;
    }

    wantsPlaybackRef.current = false;
    sourceTransitionRef.current = false;
    setIsPlaying(false);
    dispatchCurrentTrack(null);
    clearMediaSessionPositionState();
  }, [cancelPendingAudioPlay, moveToNextTrack]);

  useEffect(() => {
    handleAudioSourceFailureRef.current = handleAudioSourceFailure;
  }, [handleAudioSourceFailure]);

  useEffect(() => {
    playPreviousRef.current = playPrevious;
    playNextRef.current = playNext;
    seekToRef.current = seekTo;
  }, [playNext, playPrevious, seekTo]);

  useEffect(() => {
    const mediaSession = getMediaSession();

    if (!mediaSession) {
      return;
    }

    setMediaSessionAction("play", () => setIsPlaying(true));
    setMediaSessionAction("pause", () => setIsPlaying(false));
    setMediaSessionAction("previoustrack", () => playPreviousRef.current());
    setMediaSessionAction("nexttrack", () => playNextRef.current());
    setMediaSessionAction("seekbackward", null);
    setMediaSessionAction("seekforward", null);
    setMediaSessionAction("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        seekToRef.current(details.seekTime);
      }
    });
    setMediaSessionAction("stop", () => setIsPlaying(false));

    return () => {
      mediaSession.playbackState = "none";
      setMediaSessionTrackMetadata(null);
      clearMediaSessionPositionState();
      MEDIA_SESSION_ACTIONS.forEach((action) => setMediaSessionAction(action, null));
    };
  }, []);

  useEffect(() => {
    setMediaSessionTrackMetadata(track);

    if (!track) {
      clearMediaSessionPositionState();
    }
  }, [track]);

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
      clearMediaSessionPositionState();
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
    closeQueueMenu();
  }

  const clearQueueLongPressTimer = useCallback(() => {
    if (queueLongPressTimerRef.current !== null) {
      window.clearTimeout(queueLongPressTimerRef.current);
      queueLongPressTimerRef.current = null;
    }
  }, []);

  const stopQueueAutoScroll = useCallback(() => {
    if (queueAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(queueAutoScrollFrameRef.current);
      queueAutoScrollFrameRef.current = null;
    }
  }, []);

  const preventQueueDragTouchScroll = useCallback((event: globalThis.TouchEvent) => {
    if (!queueDragRef.current) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
  }, []);

  const lockQueueNativeScroll = useCallback(() => {
    const scrollElement = queueScrollRef.current;

    if (scrollElement) {
      if (queueTouchActionBeforeDragRef.current === null) {
        queueTouchActionBeforeDragRef.current = scrollElement.style.touchAction;
      }

      if (queueOverflowYBeforeDragRef.current === null) {
        queueOverflowYBeforeDragRef.current = scrollElement.style.overflowY;
      }

      scrollElement.style.touchAction = "none";
      scrollElement.style.overflowY = "hidden";
    }

    if (!queueTouchMoveBlockerActiveRef.current) {
      scrollElement?.addEventListener("touchmove", preventQueueDragTouchScroll, { passive: false });
      document.addEventListener("touchmove", preventQueueDragTouchScroll, { passive: false });
      queueTouchMoveBlockerActiveRef.current = true;
    }
  }, [preventQueueDragTouchScroll]);

  const unlockQueueNativeScroll = useCallback(() => {
    const scrollElement = queueScrollRef.current;

    if (scrollElement && queueTouchActionBeforeDragRef.current !== null) {
      scrollElement.style.touchAction = queueTouchActionBeforeDragRef.current;
      queueTouchActionBeforeDragRef.current = null;
    }

    if (scrollElement && queueOverflowYBeforeDragRef.current !== null) {
      scrollElement.style.overflowY = queueOverflowYBeforeDragRef.current;
      queueOverflowYBeforeDragRef.current = null;
    }

    if (queueTouchMoveBlockerActiveRef.current) {
      scrollElement?.removeEventListener("touchmove", preventQueueDragTouchScroll);
      document.removeEventListener("touchmove", preventQueueDragTouchScroll);
      queueTouchMoveBlockerActiveRef.current = false;
    }
  }, [preventQueueDragTouchScroll]);

  const reorderQueue = useCallback((fromItem: QueueDragTarget, toItem: QueueDragTarget) => {
    if (
      fromItem.source !== toItem.source ||
      fromItem.index === toItem.index
    ) {
      return;
    }

    captureQueueItemRects();

    const reorderItems = (items: QueueEntry[]) => {
      if (
        fromItem.index < 0 ||
        toItem.index < 0 ||
        fromItem.index >= items.length ||
        toItem.index >= items.length
      ) {
        return items;
      }

      return moveQueueItem(items, fromItem.index, toItem.index);
    };

    if (fromItem.source === "manual") {
      const nextManualQueue = reorderItems(manualQueueRef.current);

      manualQueueRef.current = nextManualQueue;
      setManualQueue(nextManualQueue);
    } else {
      const nextContextQueue = reorderItems(contextQueueRef.current);

      contextQueueRef.current = nextContextQueue;
      setContextQueue(nextContextQueue);
    }
  }, [captureQueueItemRects]);

  const updateQueueDragPosition = useCallback((clientY: number) => {
    const currentDrag = queueDragRef.current;

    if (!currentDrag) {
      return;
    }

    const nextDrag = {
      ...currentDrag,
      currentY: clientY,
    };

    if (!queueReorderLockedRef.current) {
      const draggedCenterY = clientY - currentDrag.offsetY + currentDrag.rowHeight / 2;
      const sourceItems = displayedQueueItemsRef.current
        .filter((item) => item.source === currentDrag.source)
        .sort((firstItem, secondItem) => firstItem.index - secondItem.index);
      let targetIndex = 0;

      sourceItems.forEach((item) => {
        if (item.key === currentDrag.key) {
          return;
        }

        const node = queueItemRefs.current.get(item.key);

        if (!node) {
          return;
        }

        const rect = node.getBoundingClientRect();
        const itemCenterY = rect.top + rect.height / 2;

        if (draggedCenterY > itemCenterY) {
          targetIndex += 1;
        }
      });

      targetIndex = Math.min(Math.max(targetIndex, 0), Math.max(sourceItems.length - 1, 0));

      if (targetIndex !== currentDrag.index) {
        queueReorderLockedRef.current = true;
        reorderQueue(
          { source: currentDrag.source, index: currentDrag.index },
          { source: currentDrag.source, index: targetIndex }
        );
        nextDrag.index = targetIndex;
      }
    }

    queueDragRef.current = nextDrag;
    setQueueDragState(nextDrag);
  }, [reorderQueue]);

  const runQueueAutoScroll = useCallback(function runQueueAutoScrollFrame() {
    const drag = queueDragRef.current;
    const scrollElement = queueScrollRef.current;

    if (!drag || !scrollElement) {
      queueAutoScrollFrameRef.current = null;
      return;
    }

    const bounds = scrollElement.getBoundingClientRect();
    const edgeSize = 48;
    const maxStep = 16;
    let scrollStep = 0;

    if (drag.currentY < bounds.top + edgeSize) {
      const distance = Math.max(0, bounds.top + edgeSize - drag.currentY);
      scrollStep = -Math.ceil((distance / edgeSize) * maxStep);
    } else if (drag.currentY > bounds.bottom - edgeSize) {
      const distance = Math.max(0, drag.currentY - (bounds.bottom - edgeSize));
      scrollStep = Math.ceil((distance / edgeSize) * maxStep);
    }

    if (scrollStep !== 0) {
      scrollElement.scrollTop += scrollStep;
      updateQueueDragPosition(drag.currentY);
    }

    queueAutoScrollFrameRef.current = window.requestAnimationFrame(runQueueAutoScrollFrame);
  }, [updateQueueDragPosition]);

  const startQueueAutoScroll = useCallback(() => {
    if (queueAutoScrollFrameRef.current !== null) {
      return;
    }

    queueAutoScrollFrameRef.current = window.requestAnimationFrame(runQueueAutoScroll);
  }, [runQueueAutoScroll]);

  const finishQueueDrag = useCallback(() => {
    const activeDrag = queueDragRef.current;

    clearQueueLongPressTimer();
    stopQueueAutoScroll();
    queuePressRef.current = null;
    queueDragRef.current = null;

    if (queueDragTargetRef.current && activeDrag) {
      try {
        if (queueDragTargetRef.current.hasPointerCapture(activeDrag.pointerId)) {
          queueDragTargetRef.current.releasePointerCapture(activeDrag.pointerId);
        }
      } catch {
        // The browser can release capture before pointerup on interrupted gestures.
      }
    }

    queueDragTargetRef.current = null;
    setQueueDragState(null);

    if (bodyUserSelectBeforeDragRef.current !== null) {
      document.body.style.userSelect = bodyUserSelectBeforeDragRef.current;
      bodyUserSelectBeforeDragRef.current = null;
    }

    unlockQueueNativeScroll();

    suppressQueueClickRef.current = true;
    window.setTimeout(() => {
      suppressQueueClickRef.current = false;
    }, 250);
  }, [clearQueueLongPressTimer, stopQueueAutoScroll, unlockQueueNativeScroll]);

  const beginQueueLongPress = useCallback((item: QueueDisplayItem, event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || isRepeatOneOn || item.source === "current" || event.button !== 0) {
      return;
    }

    const target = event.target;

    if (target instanceof Element && target.closest("[data-queue-action]")) {
      return;
    }

    clearQueueLongPressTimer();
    closeQueueMenu();

    const pressState: QueuePressState = {
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentY: event.clientY,
      target: event.currentTarget,
    };

    queuePressRef.current = pressState;
    queueLongPressTimerRef.current = window.setTimeout(() => {
      const queuedPress = queuePressRef.current;

      if (!queuedPress || queuedPress.pointerId !== pressState.pointerId) {
        return;
      }

      const row = queueItemRefs.current.get(item.key);

      if (!row || (item.source !== "manual" && item.source !== "context")) {
        return;
      }

      const rowBounds = row.getBoundingClientRect();
      const nextDrag: QueueDragState = {
        key: item.key,
        source: item.source,
        index: item.index,
        pointerId: event.pointerId,
        rowLeft: rowBounds.left,
        rowWidth: rowBounds.width,
        rowHeight: rowBounds.height,
        offsetY: queuedPress.startY - rowBounds.top,
        currentY: queuedPress.currentY,
        track: item.track,
      };

      queueDragRef.current = nextDrag;
      queueDragTargetRef.current = queuedPress.target;
      setQueueDragState(nextDrag);
      bodyUserSelectBeforeDragRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      lockQueueNativeScroll();

      try {
        queuedPress.target.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail if the OS cancels the long press.
      }

      (navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate?.(8);

      startQueueAutoScroll();
    }, 240);
  }, [clearQueueLongPressTimer, closeQueueMenu, isRepeatOneOn, lockQueueNativeScroll, startQueueAutoScroll]);

  const beginQueueTouchLongPress = useCallback((item: QueueDisplayItem, event: TouchEvent<HTMLDivElement>) => {
    if (isRepeatOneOn || item.source === "current" || event.touches.length !== 1) {
      return;
    }

    const target = event.target;

    if (target instanceof Element && target.closest("[data-queue-action]")) {
      return;
    }

    const touch = event.touches[0];

    clearQueueLongPressTimer();
    closeQueueMenu();

    const pressState: QueuePressState = {
      item,
      pointerId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      currentY: touch.clientY,
      target: event.currentTarget,
    };

    queuePressRef.current = pressState;
    queueLongPressTimerRef.current = window.setTimeout(() => {
      const queuedPress = queuePressRef.current;

      if (!queuedPress || queuedPress.pointerId !== pressState.pointerId) {
        return;
      }

      const row = queueItemRefs.current.get(item.key);

      if (!row || (item.source !== "manual" && item.source !== "context")) {
        return;
      }

      const rowBounds = row.getBoundingClientRect();
      const nextDrag: QueueDragState = {
        key: item.key,
        source: item.source,
        index: item.index,
        pointerId: touch.identifier,
        rowLeft: rowBounds.left,
        rowWidth: rowBounds.width,
        rowHeight: rowBounds.height,
        offsetY: queuedPress.startY - rowBounds.top,
        currentY: queuedPress.currentY,
        track: item.track,
      };

      queueDragRef.current = nextDrag;
      queueDragTargetRef.current = queuedPress.target;
      setQueueDragState(nextDrag);
      bodyUserSelectBeforeDragRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      lockQueueNativeScroll();

      (navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate?.(8);

      startQueueAutoScroll();
    }, 260);
  }, [clearQueueLongPressTimer, closeQueueMenu, isRepeatOneOn, lockQueueNativeScroll, startQueueAutoScroll]);

  const moveQueueLongPress = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      return;
    }

    const pressState = queuePressRef.current;

    if (!pressState || pressState.pointerId !== event.pointerId) {
      return;
    }

    pressState.currentY = event.clientY;

    if (!queueDragRef.current) {
      const deltaX = Math.abs(event.clientX - pressState.startX);
      const deltaY = Math.abs(event.clientY - pressState.startY);

      if (deltaX > 8 || deltaY > 8) {
        clearQueueLongPressTimer();
        queuePressRef.current = null;
      }

      return;
    }

    event.preventDefault();
    updateQueueDragPosition(event.clientY);
  }, [clearQueueLongPressTimer, updateQueueDragPosition]);

  const moveQueueTouchLongPress = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const pressState = queuePressRef.current;

    if (!pressState) {
      return;
    }

    const touch = Array.from(event.touches).find((currentTouch) => (
      currentTouch.identifier === pressState.pointerId
    ));

    if (!touch) {
      return;
    }

    pressState.currentY = touch.clientY;

    if (!queueDragRef.current) {
      const deltaX = Math.abs(touch.clientX - pressState.startX);
      const deltaY = Math.abs(touch.clientY - pressState.startY);

      if (deltaX > 18 || deltaY > 18) {
        clearQueueLongPressTimer();
        queuePressRef.current = null;
      }

      return;
    }

    event.preventDefault();
    updateQueueDragPosition(touch.clientY);
  }, [clearQueueLongPressTimer, updateQueueDragPosition]);

  const endQueueLongPress = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      return;
    }

    const drag = queueDragRef.current;
    const pressState = queuePressRef.current;

    if (drag && drag.pointerId === event.pointerId) {
      event.preventDefault();
      finishQueueDrag();
      return;
    }

    if (pressState?.pointerId === event.pointerId) {
      clearQueueLongPressTimer();
      queuePressRef.current = null;
    }
  }, [clearQueueLongPressTimer, finishQueueDrag]);

  const endQueueTouchLongPress = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const drag = queueDragRef.current;
    const pressState = queuePressRef.current;
    const changedTouch = pressState
      ? Array.from(event.changedTouches).find((touch) => touch.identifier === pressState.pointerId)
      : null;

    if (drag && changedTouch && drag.pointerId === changedTouch.identifier) {
      event.preventDefault();
      finishQueueDrag();
      return;
    }

    if (pressState && changedTouch) {
      clearQueueLongPressTimer();
      queuePressRef.current = null;
    }
  }, [clearQueueLongPressTimer, finishQueueDrag]);

  useEffect(() => () => {
    clearQueueLongPressTimer();
    stopQueueAutoScroll();

    if (bodyUserSelectBeforeDragRef.current !== null) {
      document.body.style.userSelect = bodyUserSelectBeforeDragRef.current;
      bodyUserSelectBeforeDragRef.current = null;
    }

    unlockQueueNativeScroll();
  }, [clearQueueLongPressTimer, stopQueueAutoScroll, unlockQueueNativeScroll]);

  const removeQueuedItem = useCallback((item: QueueDisplayItem) => {
    closeQueueMenu();

    if (item.source === "manual") {
      const nextManualQueue = manualQueueRef.current.filter((_, index) => index !== item.index);

      manualQueueRef.current = nextManualQueue;
      setManualQueue(nextManualQueue);
    } else if (item.source === "context") {
      const nextContextQueue = contextQueueRef.current.filter((_, index) => index !== item.index);

      contextQueueRef.current = nextContextQueue;
      setContextQueue(nextContextQueue);
    }
  }, [closeQueueMenu]);

  const goToQueuedTrackProject = useCallback((queuedTrack: PlayerTrack) => {
    closeQueueMenu();
    setIsExpandedPlayerOpen(false);
    setIsQueueOpen(false);
    router.push(queuedTrack.sourceHref || "/library");
  }, [closeQueueMenu, router]);

  const toggleQueueMenu = useCallback((
    item: QueueDisplayItem,
    event: MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();

    const key = item.key;

    if (openQueueMenuKey === key) {
      closeQueueMenu();
      return;
    }

    const triggerBounds = event.currentTarget.getBoundingClientRect();
    const menuWidth = Math.min(280, window.innerWidth - 24);
    const menuHeight = item.source === "current" ? 94 : 174;
    const viewportGap = 12;
    const triggerGap = 10;
    const opensDown = triggerBounds.bottom + triggerGap + menuHeight <= window.innerHeight - viewportGap;
    const top = opensDown
      ? triggerBounds.bottom + triggerGap
      : Math.max(viewportGap, triggerBounds.top - menuHeight - triggerGap);
    const left = Math.min(
      Math.max(viewportGap, triggerBounds.right - menuWidth),
      window.innerWidth - menuWidth - viewportGap
    );

    setOpenQueueMenuKey(key);
    setQueueMenuPosition({ top, left });
  }, [closeQueueMenu, openQueueMenuKey]);

  useEffect(() => {
    if (!openQueueMenuKey) {
      return;
    }

    function handleOutsidePointerDown(event: globalThis.PointerEvent) {
      const target = event.target;

      if (
        target instanceof Element &&
        (target.closest("[data-queue-menu-root]") || target.closest("[data-queue-action]"))
      ) {
        return;
      }

      closeQueueMenu();
    }

    window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [closeQueueMenu, openQueueMenuKey]);

  const renderExpandedControls = (isCompact = false) => (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={toggleShuffleMode}
        aria-label={isShuffleOn ? "Turn shuffle off" : "Shuffle"}
        aria-pressed={isShuffleOn}
        title={isShuffleOn ? "Turn shuffle off" : "Shuffle"}
        className={`flex items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isCompact ? "h-11 w-11" : "h-12 w-12"
        } ${isShuffleOn ? "bg-[var(--app-accent)] text-[var(--app-accent-ink)] hover:bg-[var(--app-accent)]" : "text-[var(--app-muted)] hover:bg-[var(--app-glass)] hover:text-[var(--app-text)]"}`}
      >
        <PlayerIcon name="shuffle" className={isCompact ? "h-4 w-4" : "h-5 w-5"} />
      </button>

      <button
        type="button"
        onClick={playPrevious}
        disabled={!canPlayPrevious}
        aria-label="Back"
        title="Back"
        className={`flex items-center justify-center rounded-full text-[var(--app-text)] transition hover:bg-[var(--app-glass)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
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
        className={`flex items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--app-accent-ink)] shadow-[0_18px_50px_rgba(0,0,0,0.25)] transition active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
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
        className={`flex items-center justify-center rounded-full text-[var(--app-text)] transition hover:bg-[var(--app-glass)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isCompact ? "h-12 w-12" : "h-14 w-14"
        }`}
      >
        <PlayerIcon name="next" className={isCompact ? "h-6 w-6" : "h-7 w-7"} />
      </button>

      <button
        type="button"
        onClick={cycleRepeatMode}
        aria-label={repeatModeTitle(repeatMode)}
        aria-pressed={isRepeatAllOn || isRepeatOneOn}
        title={repeatModeTitle(repeatMode)}
        className={`flex items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isCompact ? "h-11 w-11" : "h-12 w-12"
        } ${isRepeatAllOn || isRepeatOneOn ? "bg-[var(--app-accent)] text-[var(--app-accent-ink)] hover:bg-[var(--app-accent)]" : "text-[var(--app-muted)] hover:bg-[var(--app-glass)] hover:text-[var(--app-text)]"}`}
      >
        <PlayerIcon name={repeatModeIcon(repeatMode)} className={isCompact ? "h-4 w-4" : "h-5 w-5"} />
      </button>
    </div>
  );

  const renderQueueShortcut = (className = "mt-4") => (
    <div className={`${className} flex justify-end`}>
      <button
        type="button"
        onClick={() => {
          closeQueueMenu();
          setIsQueueOpen((current) => !current);
        }}
        aria-label="Queue"
        aria-pressed={isQueueOpen}
        title="Queue"
        className={`flex h-11 w-11 items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${
          isQueueOpen ? "bg-[var(--app-accent)] text-[var(--app-accent-ink)] hover:bg-[var(--app-accent)]" : "text-[var(--app-muted)] hover:bg-[var(--app-glass)] hover:text-[var(--app-text)]"
        }`}
      >
        <PlayerIcon name="queue" className="h-5 w-5" />
      </button>
    </div>
  );

  const renderQueuePanel = (className: string, listClassName = "max-h-56") => (
    <div className={className} aria-label="Playback queue">
      <div className="flex items-center justify-between border-b border-[var(--app-border)] px-5 py-4">
        <div className="min-w-0">
          <p className="text-xl font-semibold text-[var(--app-text)]">Queue</p>
          <p className="mt-0.5 text-xs text-[var(--app-muted)]">
            {displayedQueueItems.length} track{displayedQueueItems.length === 1 ? "" : "s"} in queue
          </p>
        </div>
        <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-glass)] px-2.5 py-1 font-mono text-xs text-[var(--app-text)]">
          {track ? 1 : 0}/{displayedQueueItems.length}
        </span>
      </div>
      <div
        ref={queueScrollRef}
        onScroll={() => {
          if (openQueueMenuKey !== null) {
            closeQueueMenu();
          }
        }}
        className={`${listClassName} queue-sort-surface scrollbar-none touch-pan-y select-none overflow-y-auto overscroll-contain p-2 pb-24`}
      >
        {displayedQueueItems.map((item) => {
          const isDraggedItem = queueDragState?.key === item.key;

          return (
            <div
              key={item.key}
              ref={(node) => setQueueItemElement(item.key, node)}
              data-queue-row
              data-queue-source={item.source}
              data-queue-index={item.index}
              onContextMenu={(event) => {
                if (item.source !== "current") {
                  event.preventDefault();
                }
              }}
              onPointerDown={(event) => beginQueueLongPress(item, event)}
              onPointerMove={moveQueueLongPress}
              onPointerUp={endQueueLongPress}
              onPointerCancel={endQueueLongPress}
              onTouchStart={(event) => beginQueueTouchLongPress(item, event)}
              onTouchMove={moveQueueTouchLongPress}
              onTouchEnd={endQueueTouchLongPress}
              onTouchCancel={endQueueTouchLongPress}
              className={`relative flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-[background-color,box-shadow,opacity,transform] duration-200 ease-out ${
                item.source === "current" ? "bg-[var(--app-glass-strong)] text-[var(--app-text)] ring-1 ring-[var(--app-border)]" : "text-[var(--app-muted)] hover:bg-[var(--app-glass)]"
              } ${isDraggedItem ? "bg-[var(--app-glass)] opacity-30 ring-1 ring-[var(--app-border)]" : "opacity-100"}`}
            >
              <button
                type="button"
                onClick={() => {
                  if (suppressQueueClickRef.current) {
                    suppressQueueClickRef.current = false;
                    return;
                  }

                  selectQueuedItem(item);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--app-glass)] font-mono text-xs text-[var(--app-text)] shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
                  {item.track.coverDataUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={item.track.coverDataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    item.index + 1
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-[var(--app-text)]">{item.track.title}</span>
                  <span className="block truncate text-xs text-[var(--app-muted)]">{item.track.artist}</span>
                </span>
              </button>

              {item.source === "current" ? (
                <span className="shrink-0 rounded-full bg-[var(--app-accent)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--app-accent-ink)]">
                  Now
                </span>
              ) : null}

              <button
                type="button"
                data-queue-action
                onPointerDown={(event) => {
                  event.stopPropagation();
                  clearQueueLongPressTimer();
                  queuePressRef.current = null;
                }}
                onPointerUp={(event) => event.stopPropagation()}
                onPointerCancel={(event) => event.stopPropagation()}
                onTouchStart={(event) => {
                  event.stopPropagation();
                  clearQueueLongPressTimer();
                  queuePressRef.current = null;
                }}
                onTouchEnd={(event) => event.stopPropagation()}
                onTouchCancel={(event) => event.stopPropagation()}
                onClick={(event) => toggleQueueMenu(item, event)}
                className="flex h-10 w-10 shrink-0 items-center justify-center gap-1 rounded-full text-[var(--app-muted)] transition hover:bg-[var(--app-glass)] hover:text-[var(--app-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                aria-label={`Open queue menu for ${item.track.title}`}
                aria-expanded={openQueueMenuKey === item.key}
                title="Queue menu"
              >
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
              </button>
            </div>
          );
        })}
      </div>
      {typeof document !== "undefined"
        ? createPortal(
          <>
            {queueDragState ? (
              <div
                className="pointer-events-none fixed z-[1000] flex min-h-16 items-center gap-3 rounded-2xl bg-[var(--app-bg)] px-3 py-2.5 text-left text-[var(--app-text)] opacity-100 shadow-[0_26px_70px_rgba(0,0,0,0.28)] ring-1 ring-[var(--app-border)]"
                style={{
                  left: queueDragState.rowLeft,
                  top: queueDragState.currentY - queueDragState.offsetY,
                  width: queueDragState.rowWidth,
                  transform: "scale(1.035)",
                }}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--app-glass)] font-mono text-xs text-[var(--app-text)] shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                  {queueDragState.track.coverDataUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={queueDragState.track.coverDataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    queueDragState.index + 1
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-[var(--app-text)]">{queueDragState.track.title}</span>
                  <span className="block truncate text-xs text-[var(--app-muted)]">{queueDragState.track.artist}</span>
                </span>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center gap-1 rounded-full text-[var(--app-muted)]">
                  <span className="h-1 w-1 rounded-full bg-current" />
                  <span className="h-1 w-1 rounded-full bg-current" />
                  <span className="h-1 w-1 rounded-full bg-current" />
                </span>
              </div>
            ) : null}
            {openQueueMenuItem && queueMenuPosition ? (
              <div
                data-queue-menu-root
                className="fixed z-[1010] w-[min(17.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-[2rem] border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-lg font-semibold text-[var(--app-text)] shadow-[0_28px_70px_rgba(0,0,0,0.28)]"
                style={{
                  top: queueMenuPosition.top,
                  left: queueMenuPosition.left,
                }}
              >
                <button
                  type="button"
                  onClick={() => goToQueuedTrackProject(openQueueMenuItem.track)}
                  className="flex min-h-16 w-full items-center gap-4 rounded-3xl px-4 text-left transition hover:bg-[var(--app-glass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                >
                  <PlayerIcon name="external" className="h-8 w-8 shrink-0" />
                  <span>Go to project</span>
                </button>
                {openQueueMenuItem.source !== "current" ? (
                  <button
                    type="button"
                    onClick={() => removeQueuedItem(openQueueMenuItem)}
                    className="mt-1 flex min-h-20 w-full items-center gap-4 rounded-3xl px-4 text-left text-red-400 transition hover:bg-red-500/[0.14] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200"
                  >
                    <PlayerIcon name="minusCircle" className="h-8 w-8 shrink-0" />
                    <span>Remove from queue</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </>,
          document.body
        )
        : null}
    </div>
  );

  return (
    <>
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) return;
          const audioDuration =
            Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
          const now = performance.now();
          const shouldRenderProgress =
            now - lastProgressRenderAtRef.current > 250 ||
            Math.abs((audioDuration || 0) - audio.currentTime) < 0.25;

          if (!shouldRenderProgress) {
            return;
          }

          lastProgressRenderAtRef.current = now;
          setCurrentTime(audioDuration > 0 ? Math.min(audio.currentTime, audioDuration) : audio.currentTime);

          if (
            !isRepeatOneOn &&
            audioDuration > 0 &&
            (audio.ended || audio.currentTime >= audioDuration - 0.05)
          ) {
            setCurrentTime(audioDuration);
            handleEnded();
          }
        }}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          endedHandledRef.current = false;
          applyAudioOutputSettings(audio, audioVolumeRef.current);
          if (track) {
            playbackFailureTrackIdsRef.current.delete(track.id);
          }
          setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
        }}
        onDurationChange={() => {
          const audio = audioRef.current;
          if (!audio) return;
          setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
        }}
        onCanPlay={() => {
          const audio = audioRef.current;

          if (!audio) {
            return;
          }

          applyAudioOutputSettings(audio, audioVolumeRef.current);

          if (wantsPlaybackRef.current && audio.paused && !audio.ended) {
            requestAudioPlay(audio);
          }
        }}
        onPlaying={() => {
          sourceTransitionRef.current = false;
          wantsPlaybackRef.current = true;
          setIsPlaying(true);
        }}
        onPause={() => {
          const audio = audioRef.current;

          if (!audio) {
            return;
          }

          if (audio.ended && !isRepeatOneOn) {
            handleEnded();
            return;
          }

          if (sourceTransitionRef.current) {
            return;
          }

          wantsPlaybackRef.current = false;
          cancelPendingAudioPlay();
          setIsPlaying(false);
        }}
        onError={() => {
          sourceTransitionRef.current = false;
          handleAudioSourceFailure();
        }}
        onEnded={handleEnded}
        hidden
      />

      {track ? (
        <>
          {isExpandedPlayerOpen ? (
            <div className="app-player-expanded fixed inset-0 z-[300] bg-[var(--app-bg)] px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-[var(--app-text)] sm:hidden">
              <div className="mx-auto flex h-full max-w-md flex-col">
                <div className="flex h-14 items-center justify-between">
                  <div className="h-1.5 w-12 rounded-full bg-[var(--app-glass-strong)]" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={collapseExpandedPlayer}
                    className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--app-text)] transition hover:bg-[var(--app-glass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
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
                      <div className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-bg-soft)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
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
                            <p className="truncate text-xl font-semibold leading-tight text-[var(--app-text)]">{track.title}</p>
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
                          {renderQueueShortcut("mt-3")}
                        </div>
                      </div>

                      {renderQueuePanel(
                        "min-h-0 flex-1 overflow-hidden rounded-[28px] border border-[var(--app-border)] bg-[var(--app-bg-soft)] shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl",
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
                        <p className="truncate text-2xl font-semibold leading-tight text-[var(--app-text)]">{track.title}</p>
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

                      <div>
                        {renderExpandedControls()}
                        {renderQueueShortcut()}
                      </div>
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
                    "mx-auto mb-3 max-h-80 max-w-4xl overflow-hidden rounded-3xl border border-[var(--app-border)] bg-[var(--app-bg-soft)] shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl"
                  )}
                </div>
              )
              : null}

            <div
              className="app-player-bar mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg-soft)] px-2 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:flex-nowrap sm:gap-3 sm:rounded-full sm:px-3"
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

              <div className="hidden items-center gap-2 font-mono text-xs text-[var(--app-text)] sm:flex">
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
                  className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--app-text)] transition hover:bg-[var(--app-glass)] disabled:cursor-not-allowed disabled:opacity-35 sm:h-10 sm:w-10"
                >
                  <PlayerIcon name="previous" className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsPlaying((current) => !current)}
                  aria-label={isPlaying ? "Pause" : "Play"}
                  title={isPlaying ? "Pause" : "Play"}
                  className="flex h-[52px] min-h-[52px] w-[52px] min-w-[52px] items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--app-accent-ink)] shadow-[0_10px_30px_rgba(0,0,0,0.22)] sm:h-10 sm:min-h-10 sm:w-10 sm:min-w-10"
                >
                  <PlayerIcon name={isPlaying ? "pause" : "play"} className="h-5 w-5 sm:h-4 sm:w-4" />
                </button>

                <button
                  type="button"
                  onClick={playNext}
                  disabled={!canPlayNext}
                  aria-label="Skip"
                  title="Skip"
                  className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--app-text)] transition hover:bg-[var(--app-glass)] disabled:cursor-not-allowed disabled:opacity-35 sm:h-10 sm:w-10"
                >
                  <PlayerIcon name="next" className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={toggleShuffleMode}
                  aria-label={isShuffleOn ? "Turn shuffle off" : "Shuffle"}
                  aria-pressed={isShuffleOn}
                  title={isShuffleOn ? "Turn shuffle off" : "Shuffle"}
                  className={`hidden h-10 w-10 items-center justify-center rounded-full transition sm:flex ${
                    isShuffleOn ? "bg-[var(--app-accent)] text-[var(--app-accent-ink)] hover:bg-[var(--app-accent)]" : "text-[var(--app-muted)] hover:bg-[var(--app-glass)] hover:text-[var(--app-text)]"
                  }`}
                >
                  <PlayerIcon name="shuffle" />
                </button>

                <button
                  type="button"
                  onClick={cycleRepeatMode}
                  aria-label={repeatModeTitle(repeatMode)}
                  aria-pressed={isRepeatAllOn || isRepeatOneOn}
                  title={repeatModeTitle(repeatMode)}
                  className={`hidden h-10 w-10 items-center justify-center rounded-full transition sm:flex ${
                    isRepeatAllOn || isRepeatOneOn ? "bg-[var(--app-accent)] text-[var(--app-accent-ink)] hover:bg-[var(--app-accent)]" : "text-[var(--app-muted)] hover:bg-[var(--app-glass)] hover:text-[var(--app-text)]"
                  }`}
                >
                  <PlayerIcon name={repeatModeIcon(repeatMode)} />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeQueueMenu();
                    setIsQueueOpen((current) => !current);
                  }}
                  aria-label="Queue"
                  aria-pressed={isQueueOpen}
                  title="Queue"
                  className={`hidden h-10 w-10 items-center justify-center rounded-full transition sm:flex ${
                    isQueueOpen ? "bg-[var(--app-accent)] text-[var(--app-accent-ink)] hover:bg-[var(--app-accent)]" : "text-[var(--app-text)] hover:bg-[var(--app-glass)]"
                  }`}
                >
                  <PlayerIcon name="queue" />
                </button>

                <div className="group relative hidden sm:block">
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--app-text)] transition hover:bg-[var(--app-glass)] focus:bg-[var(--app-glass)]"
                    aria-label="Volume"
                    title="Volume"
                  >
                    <PlayerIcon name="volume" />
                  </button>
                  <div className="pointer-events-none absolute bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-bg-soft)] px-3 py-4 opacity-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur-xl transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={volumeLevel}
                      onChange={(event) => setVolumeLevel(clampVolumeLevel(Number(event.currentTarget.value)))}
                      className="h-24 w-2 accent-[var(--app-accent)] [direction:rtl] [writing-mode:vertical-lr]"
                      aria-label="Volume"
                    />
                    <span className="text-[10px] text-[var(--app-muted)]">{Math.round(volumeLevel)}</span>
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
