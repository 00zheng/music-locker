import type { SupabaseClient } from "@supabase/supabase-js";

export type ThemeId = "nocturne" | "sunset" | "ocean" | "forest";

export type AppThemePreferences = {
  themeId: ThemeId;
  roundedCards: boolean;
  compactMode: boolean;
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
};

const PROFILE_PREFIX = "music-locker-profile:";
const THEME_PREFIX = "music-locker-theme:";
const TRACK_META_PREFIX = "music-locker-track-meta:";
const PLAYLIST_PREFIX = "music-locker-playlists:";
const PLAYLIST_FOLDER_PREFIX = "music-locker-playlist-folders:";
const SYNC_BUCKET = "music";

const defaultTheme: AppThemePreferences = {
  themeId: "nocturne",
  roundedCards: true,
  compactMode: false,
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

function syncedPreferencesPath(userId: string) {
  return `${userId}/.music-locker/preferences.json`;
}

function normalizePreferences(value: Partial<SyncedUserPreferences>): SyncedUserPreferences {
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
      ? value.playlists.map((playlist, index) => ({
          ...playlist,
          manualOrder:
            typeof playlist.manualOrder === "number" ? playlist.manualOrder : index,
          trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds : [],
          coverDataUrl: playlist.coverDataUrl || null,
          folderId: playlist.folderId || null,
        }))
      : [],
    playlistFolders: Array.isArray(value.playlistFolders)
      ? value.playlistFolders.map((folder, index) => ({
          ...folder,
          manualOrder:
            typeof folder.manualOrder === "number" ? folder.manualOrder : index,
        }))
      : [],
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
    preferences.playlistFolders.length > 0
  );
}

function localUserPreferences(userId: string): SyncedUserPreferences {
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
  setUserProfilePreferences(userId, preferences.profile);
  setAppThemePreferences(userId, preferences.theme);
  setTrackMetadata(userId, preferences.trackMetadata);
  setPlaylists(userId, preferences.playlists);
  setPlaylistFolders(userId, preferences.playlistFolders);
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
    coverDataUrl: playlist.coverDataUrl || null,
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
  const { data, error } = await supabase.storage
    .from(SYNC_BUCKET)
    .download(syncedPreferencesPath(userId));

  if (!error && data) {
    try {
      const remotePreferences = normalizePreferences(JSON.parse(await data.text()));
      writeLocalUserPreferences(userId, remotePreferences);
      return {
        preferences: remotePreferences,
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
  const preferences = normalizePreferences({
    ...localUserPreferences(userId),
    ...value,
    updatedAt: new Date().toISOString(),
  });
  const payload = JSON.stringify(preferences);

  writeLocalUserPreferences(userId, preferences);

  const { error } = await supabase.storage
    .from(SYNC_BUCKET)
    .upload(syncedPreferencesPath(userId), new Blob([payload], { type: "application/json" }), {
      upsert: true,
      contentType: "application/json",
    });

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
}
