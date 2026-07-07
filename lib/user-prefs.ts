import type { SupabaseClient } from "@supabase/supabase-js";

export type ThemeId = "nocturne" | "sunset" | "ocean" | "forest";

export type AppThemePreferences = {
  themeId: ThemeId;
  roundedCards: boolean;
  compactMode: boolean;
  contentWidth: "compact" | "default" | "wide";
};

export type UserProfilePreferences = {
  username: string;
  bio: string;
  avatarDataUrl: string | null;
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
  folderId?: string | null;
};

export type PlaylistFolder = {
  id: string;
  name: string;
  manualOrder: number;
  createdAt: string;
};

export type SyncedUserPreferences = {
  version: 1;
  updatedAt: string;
  profile: UserProfilePreferences;
  theme: AppThemePreferences;
  trackMetadata: TrackMetadataById;
  playlists: Playlist[];
  playlistFolders: PlaylistFolder[];
  deletedPlaylistIds: string[];
  deletedPlaylistFolderIds: string[];
};

export const USER_PREFERENCES_UPDATED_EVENT = "music-locker:user-preferences-updated";

const PROFILE_PREFIX = "music-locker-profile:";
const THEME_PREFIX = "music-locker-theme:";
const TRACK_META_PREFIX = "music-locker-track-meta:";
const PLAYLIST_PREFIX = "music-locker-playlists:";
const PLAYLIST_FOLDER_PREFIX = "music-locker-playlist-folders:";
const SYNC_PREFS_PREFIX = "music-locker-synced-prefs:";
const SYNC_BUCKET = "music";
const SYNC_EVENTS_TABLE = "sync_events";

const defaultTheme: AppThemePreferences = {
  themeId: "nocturne",
  roundedCards: true,
  compactMode: false,
  contentWidth: "default",
};

const defaultProfile: UserProfilePreferences = {
  username: "",
  bio: "",
  avatarDataUrl: null,
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

function profileKey(userId: string) {
  return `${PROFILE_PREFIX}${userId}`;
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

function playlistFolderKey(userId: string) {
  return `${PLAYLIST_FOLDER_PREFIX}${userId}`;
}

function syncedLocalKey(userId: string) {
  return `${SYNC_PREFS_PREFIX}${userId}`;
}

function syncedPreferencesPath(userId: string) {
  return `${userId}/.music-locker/preferences.json`;
}

function normalizePreferences(value: Partial<SyncedUserPreferences>): SyncedUserPreferences {
  const deletedPlaylistIds = uniqueValues(value.deletedPlaylistIds || []);
  const deletedPlaylistFolderIds = uniqueValues(value.deletedPlaylistFolderIds || []);

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    profile: {
      ...defaultProfile,
      ...(value.profile || {}),
    },
    theme: {
      ...defaultTheme,
      ...(value.theme || {}),
    },
    trackMetadata: value.trackMetadata || {},
    playlists: Array.isArray(value.playlists)
      ? value.playlists
          .filter((playlist) => !deletedPlaylistIds.includes(playlist.id))
          .map((playlist, index) => ({
            ...playlist,
            manualOrder:
              typeof playlist.manualOrder === "number" ? playlist.manualOrder : index,
            trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds : [],
            coverDataUrl: playlist.coverStoragePath ? null : playlist.coverDataUrl || null,
            coverStoragePath: playlist.coverStoragePath || null,
            folderId:
              playlist.folderId && !deletedPlaylistFolderIds.includes(playlist.folderId)
                ? playlist.folderId
                : null,
          }))
      : [],
    playlistFolders: Array.isArray(value.playlistFolders)
      ? value.playlistFolders
          .filter((folder) => !deletedPlaylistFolderIds.includes(folder.id))
          .map((folder, index) => ({
            ...folder,
            manualOrder:
              typeof folder.manualOrder === "number" ? folder.manualOrder : index,
          }))
      : [],
    deletedPlaylistIds,
    deletedPlaylistFolderIds,
  };
}

function hasMeaningfulPreferences(preferences: SyncedUserPreferences) {
  return (
    Boolean(preferences.profile.username || preferences.profile.bio || preferences.profile.avatarDataUrl) ||
    preferences.theme.themeId !== defaultTheme.themeId ||
    preferences.theme.roundedCards !== defaultTheme.roundedCards ||
    preferences.theme.compactMode !== defaultTheme.compactMode ||
    Object.keys(preferences.trackMetadata).length > 0 ||
    preferences.playlists.length > 0 ||
    preferences.playlistFolders.length > 0 ||
    preferences.deletedPlaylistIds.length > 0 ||
    preferences.deletedPlaylistFolderIds.length > 0
  );
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
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
  const deletedPlaylistFolderIds = uniqueValues([
    ...preferredPreferences.deletedPlaylistFolderIds,
    ...fallbackPreferences.deletedPlaylistFolderIds,
  ]);
  const remotePlaylistIds = remotePreferences.playlists.map((playlist) => playlist.id);
  const localOnlyPlaylistIds = localPreferences.playlists
    .filter(
      (playlist) =>
        !remotePlaylistIds.includes(playlist.id) &&
        isNewerLocalOnlyItem(playlist, safeLocalTimestamp, safeRemoteTimestamp)
    )
    .map((playlist) => playlist.id);
  const remoteFolderIds = remotePreferences.playlistFolders.map((folder) => folder.id);
  const localOnlyFolderIds = localPreferences.playlistFolders
    .filter(
      (folder) =>
        !remoteFolderIds.includes(folder.id) &&
        isNewerLocalOnlyItem(folder, safeLocalTimestamp, safeRemoteTimestamp)
    )
    .map((folder) => folder.id);
  const playlistIds = uniqueValues([...remotePlaylistIds, ...localOnlyPlaylistIds]).filter(
    (playlistId) => !deletedPlaylistIds.includes(playlistId)
  );
  const folderIds = uniqueValues([...remoteFolderIds, ...localOnlyFolderIds]).filter(
    (folderId) => !deletedPlaylistFolderIds.includes(folderId)
  );

  return normalizePreferences({
    ...preferredPreferences,
    updatedAt: new Date(
      Math.max(
        safeLocalTimestamp,
        safeRemoteTimestamp
      )
    ).toISOString(),
    trackMetadata: {
      ...fallbackPreferences.trackMetadata,
      ...preferredPreferences.trackMetadata,
    },
    playlists: playlistIds
      .flatMap((playlistId, index): Playlist[] => {
        const remotePlaylist = remotePreferences.playlists.find((playlist) => playlist.id === playlistId);
        const localPlaylist = localPreferences.playlists.find((playlist) => playlist.id === playlistId);
        const preferredPlaylist =
          preferredPreferences.playlists.find((playlist) => playlist.id === playlistId) ||
          remotePlaylist;
        const fallbackPlaylist =
          fallbackPreferences.playlists.find((playlist) => playlist.id === playlistId) ||
          localPlaylist;
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
          folderId:
            playlist.folderId && !deletedPlaylistFolderIds.includes(playlist.folderId)
              ? playlist.folderId
              : null,
        }];
      })
      .sort((a, b) => a.manualOrder - b.manualOrder),
    playlistFolders: folderIds
      .map((folderId, index) => {
        const folder =
          remotePreferences.playlistFolders.find((currentFolder) => currentFolder.id === folderId) ||
          preferredPreferences.playlistFolders.find((currentFolder) => currentFolder.id === folderId) ||
          fallbackPreferences.playlistFolders.find((currentFolder) => currentFolder.id === folderId);

        return folder
          ? {
              ...folder,
              manualOrder: typeof folder.manualOrder === "number" ? folder.manualOrder : index,
            }
          : null;
      })
      .filter((folder): folder is PlaylistFolder => Boolean(folder))
      .sort((a, b) => a.manualOrder - b.manualOrder),
    deletedPlaylistIds,
    deletedPlaylistFolderIds,
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
    profile: getUserProfilePreferences(userId),
    theme: getAppThemePreferences(userId),
    trackMetadata: getTrackMetadata(userId),
    playlists: getPlaylists(userId),
    playlistFolders: getPlaylistFolders(userId),
  });
}

function writeLocalUserPreferences(userId: string, preferences: SyncedUserPreferences) {
  writeJson(syncedLocalKey(userId), preferences);
  setUserProfilePreferences(userId, preferences.profile);
  setAppThemePreferences(userId, preferences.theme);
  setTrackMetadata(userId, preferences.trackMetadata);
  setPlaylists(userId, preferences.playlists);
  setPlaylistFolders(userId, preferences.playlistFolders);
}

function mergePlaylistUpdates(
  basePlaylists: Playlist[],
  updatedPlaylists: Playlist[],
  deletedPlaylistIds: string[],
  deletedPlaylistFolderIds: string[]
) {
  return uniqueValues([
    ...basePlaylists.map((playlist) => playlist.id),
    ...updatedPlaylists.map((playlist) => playlist.id),
  ])
    .filter((playlistId) => !deletedPlaylistIds.includes(playlistId))
    .flatMap((playlistId): Playlist[] => {
      const playlist =
        updatedPlaylists.find((currentPlaylist) => currentPlaylist.id === playlistId) ||
        basePlaylists.find((currentPlaylist) => currentPlaylist.id === playlistId);

      if (!playlist) {
        return [];
      }

      return [{
        ...playlist,
        folderId:
          playlist.folderId && !deletedPlaylistFolderIds.includes(playlist.folderId)
            ? playlist.folderId
            : null,
      }];
    });
}

function mergePlaylistFolderUpdates(
  baseFolders: PlaylistFolder[],
  updatedFolders: PlaylistFolder[],
  deletedPlaylistFolderIds: string[]
) {
  return uniqueValues([
    ...baseFolders.map((folder) => folder.id),
    ...updatedFolders.map((folder) => folder.id),
  ])
    .filter((folderId) => !deletedPlaylistFolderIds.includes(folderId))
    .flatMap((folderId): PlaylistFolder[] => {
      const folder =
        updatedFolders.find((currentFolder) => currentFolder.id === folderId) ||
        baseFolders.find((currentFolder) => currentFolder.id === folderId);

      return folder ? [folder] : [];
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

export function getUserProfilePreferences(userId: string) {
  return {
    ...defaultProfile,
    ...readJson<UserProfilePreferences>(profileKey(userId), defaultProfile),
  };
}

export function setUserProfilePreferences(
  userId: string,
  value: UserProfilePreferences
) {
  writeJson(profileKey(userId), value);
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

  return playlists.map((playlist, index) => ({
    ...playlist,
    manualOrder:
      typeof playlist.manualOrder === "number" ? playlist.manualOrder : index,
    trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds : [],
    coverDataUrl: playlist.coverStoragePath ? null : playlist.coverDataUrl || null,
    coverStoragePath: playlist.coverStoragePath || null,
    folderId: playlist.folderId || null,
  }));
}

export function setPlaylists(userId: string, playlists: Playlist[]) {
  writeJson(playlistKey(userId), playlists);
}

export function getPlaylistFolders(userId: string) {
  const folders = readJson<PlaylistFolder[]>(playlistFolderKey(userId), []);

  return folders.map((folder, index) => ({
    ...folder,
    manualOrder:
      typeof folder.manualOrder === "number" ? folder.manualOrder : index,
  }));
}

export function setPlaylistFolders(userId: string, folders: PlaylistFolder[]) {
  writeJson(playlistFolderKey(userId), folders);
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
    deletedPlaylistFolderIds: uniqueValues([
      ...currentPreferences.deletedPlaylistFolderIds,
      ...(value.deletedPlaylistFolderIds || []),
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
  const deletedPlaylistFolderIds = uniqueValues([
    ...basePreferences.deletedPlaylistFolderIds,
    ...(value.deletedPlaylistFolderIds || []),
  ]);
  const playlists = Array.isArray(value.playlists)
    ? mergePlaylistUpdates(
        basePreferences.playlists,
        value.playlists,
        deletedPlaylistIds,
        deletedPlaylistFolderIds
      )
    : basePreferences.playlists;
  const playlistFolders = Array.isArray(value.playlistFolders)
    ? mergePlaylistFolderUpdates(
        basePreferences.playlistFolders,
        value.playlistFolders,
        deletedPlaylistFolderIds
      )
    : basePreferences.playlistFolders;
  const preferences = normalizePreferences({
    ...basePreferences,
    ...value,
    playlists,
    playlistFolders,
    updatedAt: new Date().toISOString(),
    deletedPlaylistIds,
    deletedPlaylistFolderIds,
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
