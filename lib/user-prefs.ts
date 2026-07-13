import type { SupabaseClient } from "@supabase/supabase-js";

export type ThemeId = "nocturne" | "sunset" | "ocean" | "forest" | "light";

export type AppThemePreferences = {
  themeId: ThemeId;
  roundedCards: boolean;
  compactMode: boolean;
  contentWidth: "compact" | "default" | "wide";
};

export type TrackLocalMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  coverDataUrl?: string;
  isFavorite?: boolean;
  manualOrder?: number;
};

export type TrackMetadataById = Record<string, TrackLocalMetadata>;

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  manualOrder: number;
  createdAt: string;
  coverDataUrl?: string | null;
  coverStoragePath?: string | null;
};

export type SyncedUserPreferences = {
  version: 1;
  updatedAt: string;
  theme: AppThemePreferences;
  trackMetadata: TrackMetadataById;
  playlists: Playlist[];
  deletedPlaylistIds: string[];
};

export const USER_PREFERENCES_UPDATED_EVENT = "music-locker:user-preferences-updated";

const THEME_PREFIX = "music-locker-theme:";
const TRACK_META_PREFIX = "music-locker-track-meta:";
const PLAYLIST_PREFIX = "music-locker-playlists:";
const SYNC_PREFS_PREFIX = "music-locker-synced-prefs:";
const SYNC_BUCKET = "music";
const SYNC_EVENTS_TABLE = "sync_events";

const defaultTheme: AppThemePreferences = {
  themeId: "nocturne",
  roundedCards: true,
  compactMode: false,
  contentWidth: "default",
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(key);

    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

function themeKey(userId: string) {
  return `${THEME_PREFIX}${userId}`;
}

function trackMetaKey(userId: string) {
  return `${TRACK_META_PREFIX}${userId}`;
}

function playlistKey(userId: string) {
  return `${PLAYLIST_PREFIX}${userId}`;
}

function syncedLocalKey(userId: string) {
  return `${SYNC_PREFS_PREFIX}${userId}`;
}

function syncedPreferencesPath(userId: string) {
  return `${userId}/.music-locker/preferences.json`;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTrackMetadata(value: unknown): TrackMetadataById {
  return isRecord(value) ? (value as TrackMetadataById) : {};
}

function normalizePlaylist(value: Partial<Playlist>, index: number): Playlist | null {
  if (!value || typeof value.id !== "string") {
    return null;
  }

  const coverStoragePath = typeof value.coverStoragePath === "string" ? value.coverStoragePath : null;

  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : "untitled playlist",
    trackIds: Array.isArray(value.trackIds) ? uniqueValues(value.trackIds) : [],
    manualOrder: typeof value.manualOrder === "number" ? value.manualOrder : index,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    coverDataUrl: coverStoragePath ? null : value.coverDataUrl || null,
    coverStoragePath,
  };
}

function playlistMap(playlists: Playlist[]) {
  return new Map(playlists.map((playlist) => [playlist.id, playlist]));
}

function normalizePreferences(value: Partial<SyncedUserPreferences>): SyncedUserPreferences {
  const deletedPlaylistIds = uniqueValues(value.deletedPlaylistIds || []);
  const playlists = Array.isArray(value.playlists)
    ? value.playlists.flatMap((playlist, index): Playlist[] => {
        const normalizedPlaylist = normalizePlaylist(playlist, index);

        return normalizedPlaylist && !deletedPlaylistIds.includes(normalizedPlaylist.id)
          ? [normalizedPlaylist]
          : [];
      })
    : [];

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    theme: {
      ...defaultTheme,
      ...(isRecord(value.theme) ? value.theme : {}),
    },
    trackMetadata: normalizeTrackMetadata(value.trackMetadata),
    playlists,
    deletedPlaylistIds,
  };
}

function hasMeaningfulPreferences(preferences: SyncedUserPreferences) {
  return (
    preferences.theme.themeId !== defaultTheme.themeId ||
    preferences.theme.roundedCards !== defaultTheme.roundedCards ||
    preferences.theme.compactMode !== defaultTheme.compactMode ||
    preferences.theme.contentWidth !== defaultTheme.contentWidth ||
    Object.keys(preferences.trackMetadata).length > 0 ||
    preferences.playlists.length > 0 ||
    preferences.deletedPlaylistIds.length > 0
  );
}

function isNewerLocalOnlyItem(
  item: { createdAt: string },
  localTimestamp: number,
  remoteTimestamp: number
) {
  return localTimestamp > remoteTimestamp && parseTimestamp(item.createdAt) > remoteTimestamp;
}

function mergePreferences(
  localPreferences: SyncedUserPreferences,
  remotePreferences: SyncedUserPreferences
) {
  const localTimestamp = Date.parse(localPreferences.updatedAt);
  const remoteTimestamp = Date.parse(remotePreferences.updatedAt);
  const safeLocalTimestamp = Number.isFinite(localTimestamp) ? localTimestamp : 0;
  const safeRemoteTimestamp = Number.isFinite(remoteTimestamp) ? remoteTimestamp : 0;
  const preferLocal =
    Number.isFinite(localTimestamp) &&
    Number.isFinite(remoteTimestamp) &&
    localTimestamp > remoteTimestamp;
  const preferredPreferences = preferLocal ? localPreferences : remotePreferences;
  const fallbackPreferences = preferLocal ? remotePreferences : localPreferences;
  const deletedPlaylistIds = uniqueValues([
    ...preferredPreferences.deletedPlaylistIds,
    ...fallbackPreferences.deletedPlaylistIds,
  ]);
  const remotePlaylistsById = playlistMap(remotePreferences.playlists);
  const localPlaylistsById = playlistMap(localPreferences.playlists);
  const preferredPlaylistsById = playlistMap(preferredPreferences.playlists);
  const fallbackPlaylistsById = playlistMap(fallbackPreferences.playlists);
  const remotePlaylistIds = remotePreferences.playlists.map((playlist) => playlist.id);
  const localOnlyPlaylistIds = localPreferences.playlists
    .filter(
      (playlist) =>
        !remotePlaylistsById.has(playlist.id) &&
        isNewerLocalOnlyItem(playlist, safeLocalTimestamp, safeRemoteTimestamp)
    )
    .map((playlist) => playlist.id);
  const playlistIds = uniqueValues([...remotePlaylistIds, ...localOnlyPlaylistIds]).filter(
    (playlistId) => !deletedPlaylistIds.includes(playlistId)
  );

  return normalizePreferences({
    ...preferredPreferences,
    updatedAt: new Date(Math.max(safeLocalTimestamp, safeRemoteTimestamp)).toISOString(),
    trackMetadata: {
      ...fallbackPreferences.trackMetadata,
      ...preferredPreferences.trackMetadata,
    },
    playlists: playlistIds
      .flatMap((playlistId, index): Playlist[] => {
        const remotePlaylist = remotePlaylistsById.get(playlistId);
        const preferredPlaylist = preferredPlaylistsById.get(playlistId) || remotePlaylist;
        const fallbackPlaylist = fallbackPlaylistsById.get(playlistId) || localPlaylistsById.get(playlistId);
        const playlist = remotePlaylist || preferredPlaylist || fallbackPlaylist;

        if (!playlist) {
          return [];
        }

        const coverStoragePath =
          preferredPlaylist?.coverStoragePath || fallbackPlaylist?.coverStoragePath || null;

        return [{
          ...playlist,
          manualOrder:
            typeof preferredPlaylist?.manualOrder === "number"
              ? preferredPlaylist.manualOrder
              : fallbackPlaylist?.manualOrder ?? index,
          trackIds: preferredPlaylist
            ? uniqueValues(preferredPlaylist.trackIds)
            : uniqueValues(fallbackPlaylist?.trackIds || []),
          coverDataUrl: coverStoragePath
            ? null
            : preferredPlaylist?.coverDataUrl || fallbackPlaylist?.coverDataUrl || null,
          coverStoragePath,
        }];
      })
      .sort((a, b) => a.manualOrder - b.manualOrder),
    deletedPlaylistIds,
  });
}

function localUserPreferences(userId: string): SyncedUserPreferences {
  const savedSyncedPreferences = readJson<SyncedUserPreferences | null>(
    syncedLocalKey(userId),
    null
  );

  if (savedSyncedPreferences) {
    return normalizePreferences(savedSyncedPreferences);
  }

  return normalizePreferences({
    updatedAt: new Date().toISOString(),
    theme: getAppThemePreferences(userId),
    trackMetadata: getTrackMetadata(userId),
    playlists: getPlaylists(userId),
  });
}

function writeLocalUserPreferences(userId: string, preferences: SyncedUserPreferences) {
  writeJson(syncedLocalKey(userId), preferences);
  setAppThemePreferences(userId, preferences.theme);
  setTrackMetadata(userId, preferences.trackMetadata);
  setPlaylists(userId, preferences.playlists);
}

function mergePlaylistUpdates(
  basePlaylists: Playlist[],
  updatedPlaylists: Playlist[],
  deletedPlaylistIds: string[]
) {
  const playlistsById = new Map(basePlaylists.map((playlist) => [playlist.id, playlist]));

  updatedPlaylists.forEach((playlist) => {
    playlistsById.set(playlist.id, playlist);
  });

  return uniqueValues([
    ...basePlaylists.map((playlist) => playlist.id),
    ...updatedPlaylists.map((playlist) => playlist.id),
  ])
    .filter((playlistId) => !deletedPlaylistIds.includes(playlistId))
    .flatMap((playlistId, index): Playlist[] => {
      const normalizedPlaylist = normalizePlaylist(playlistsById.get(playlistId) || {}, index);

      return normalizedPlaylist ? [normalizedPlaylist] : [];
    });
}

async function downloadSyncedUserPreferences(
  supabase: SupabaseClient,
  userId: string
) {
  const { data, error } = await supabase.storage
    .from(SYNC_BUCKET)
    .download(syncedPreferencesPath(userId));

  if (error || !data) {
    return null;
  }

  try {
    return normalizePreferences(JSON.parse(await data.text()));
  } catch {
    return null;
  }
}

export function getAppThemePreferences(userId: string) {
  return {
    ...defaultTheme,
    ...readJson<AppThemePreferences>(themeKey(userId), defaultTheme),
  };
}

export function setAppThemePreferences(userId: string, value: AppThemePreferences) {
  writeJson(themeKey(userId), value);
}

export function getTrackMetadata(userId: string) {
  return readJson<TrackMetadataById>(trackMetaKey(userId), {});
}

export function setTrackMetadata(userId: string, value: TrackMetadataById) {
  writeJson(trackMetaKey(userId), value);
}

export function getPlaylists(userId: string) {
  const playlists = readJson<Playlist[]>(playlistKey(userId), []);

  return playlists.flatMap((playlist, index): Playlist[] => {
    const normalizedPlaylist = normalizePlaylist(playlist, index);

    return normalizedPlaylist ? [normalizedPlaylist] : [];
  });
}

export function setPlaylists(userId: string, playlists: Playlist[]) {
  writeJson(
    playlistKey(userId),
    playlists.flatMap((playlist, index): Playlist[] => {
      const normalizedPlaylist = normalizePlaylist(playlist, index);

      return normalizedPlaylist ? [normalizedPlaylist] : [];
    })
  );
}

export async function loadSyncedUserPreferences(
  supabase: SupabaseClient,
  userId: string
) {
  const localPreferences = localUserPreferences(userId);
  const remotePreferences = await downloadSyncedUserPreferences(supabase, userId);

  if (remotePreferences) {
    try {
      const mergedPreferences = mergePreferences(localPreferences, remotePreferences);

      writeLocalUserPreferences(userId, mergedPreferences);

      if (JSON.stringify(mergedPreferences) !== JSON.stringify(remotePreferences)) {
        await saveSyncedUserPreferences(supabase, userId, mergedPreferences);
        return {
          preferences: mergedPreferences,
          source: "local" as const,
        };
      }

      return {
        preferences: mergedPreferences,
        source: "cloud" as const,
      };
    } catch {
      return {
        preferences: localPreferences,
        source: "local" as const,
      };
    }
  }

  if (hasMeaningfulPreferences(localPreferences)) {
    await saveSyncedUserPreferences(supabase, userId, localPreferences);
  }

  return {
    preferences: localPreferences,
    source: "local" as const,
  };
}

export async function saveSyncedUserPreferences(
  supabase: SupabaseClient,
  userId: string,
  value: Partial<SyncedUserPreferences>
) {
  const currentPreferences = localUserPreferences(userId);
  const optimisticUpdatedAt = new Date().toISOString();
  const optimisticPreferences = normalizePreferences({
    ...currentPreferences,
    ...value,
    updatedAt: optimisticUpdatedAt,
    deletedPlaylistIds: uniqueValues([
      ...currentPreferences.deletedPlaylistIds,
      ...(value.deletedPlaylistIds || []),
    ]),
  });

  writeLocalUserPreferences(userId, optimisticPreferences);

  const remotePreferences = await downloadSyncedUserPreferences(supabase, userId);
  const basePreferences = remotePreferences
    ? mergePreferences(optimisticPreferences, remotePreferences)
    : optimisticPreferences;
  const deletedPlaylistIds = uniqueValues([
    ...basePreferences.deletedPlaylistIds,
    ...(value.deletedPlaylistIds || []),
  ]);
  const playlists = Array.isArray(value.playlists)
    ? mergePlaylistUpdates(basePreferences.playlists, value.playlists, deletedPlaylistIds)
    : basePreferences.playlists;
  const preferences = normalizePreferences({
    ...basePreferences,
    ...value,
    playlists,
    updatedAt: new Date().toISOString(),
    deletedPlaylistIds,
  });
  const payload = JSON.stringify(preferences);

  writeLocalUserPreferences(userId, preferences);

  const { error } = await supabase.storage
    .from(SYNC_BUCKET)
    .upload(syncedPreferencesPath(userId), new Blob([payload], { type: "application/json" }), {
      upsert: true,
      contentType: "application/json",
    });

  if (!error) {
    await supabase
      .from(SYNC_EVENTS_TABLE)
      .upsert(
        {
          user_id: userId,
          updated_at: preferences.updatedAt,
        },
        { onConflict: "user_id" }
      );
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(USER_PREFERENCES_UPDATED_EVENT));
  }

  return {
    preferences,
    error,
  };
}

export function applyThemeToDocument(theme: AppThemePreferences) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme.themeId;
  document.documentElement.dataset.cardRound = theme.roundedCards ? "on" : "off";
  document.documentElement.dataset.compact = theme.compactMode ? "on" : "off";
  document.documentElement.dataset.contentWidth = theme.contentWidth || "default";
}
