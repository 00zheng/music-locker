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

const PROFILE_PREFIX = "music-locker-profile:";
const THEME_PREFIX = "music-locker-theme:";
const TRACK_META_PREFIX = "music-locker-track-meta:";
const PLAYLIST_PREFIX = "music-locker-playlists:";
const PLAYLIST_FOLDER_PREFIX = "music-locker-playlist-folders:";

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

export function applyThemeToDocument(theme: AppThemePreferences) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme.themeId;
  document.documentElement.dataset.cardRound = theme.roundedCards ? "on" : "off";
  document.documentElement.dataset.compact = theme.compactMode ? "on" : "off";
}
