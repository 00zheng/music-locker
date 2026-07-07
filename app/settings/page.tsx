"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Image from "next/image";

import Navbar from "@/components/Navbar";
import { supabase } from "@/lib/supabase";
import {
  applyThemeToDocument,
  loadSyncedUserPreferences,
  saveSyncedUserPreferences,
  type AppThemePreferences,
  type ThemeId,
  type UserProfilePreferences,
} from "@/lib/user-prefs";

const themeChoices: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: "nocturne", label: "Black", description: "Simple monochrome" },
  { id: "sunset", label: "Gray", description: "Simple monochrome" },
  { id: "ocean", label: "Slate", description: "Simple monochrome" },
  { id: "forest", label: "Soft Black", description: "Simple monochrome" },
];

const widthChoices: Array<{ id: AppThemePreferences["contentWidth"]; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "default", label: "Default" },
  { id: "wide", label: "Wide" },
];

type StorageSummary = {
  cloudBytes: number;
  offlineBytes: number;
  browserUsageBytes: number | null;
  browserQuotaBytes: number | null;
};

const OFFLINE_TRACKS_PREFIX = "music-locker-offline-tracks:";

function offlineTracksKey(userId: string) {
  return `${OFFLINE_TRACKS_PREFIX}${userId}`;
}

function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let nextValue = value / 1024;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(nextValue >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function readOfflineBytes(userId: string) {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const raw = localStorage.getItem(offlineTracksKey(userId));
    const tracks = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(tracks)) {
      return 0;
    }

    return tracks.reduce((total, track) => total + (Number(track?.file_size) || 0), 0);
  } catch {
    return 0;
  }
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file."));

    reader.readAsDataURL(file);
  });
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [profile, setProfile] = useState<UserProfilePreferences>({
    username: "",
    bio: "",
    avatarDataUrl: null,
  });

  const [theme, setTheme] = useState<AppThemePreferences>({
    themeId: "nocturne",
    roundedCards: true,
    compactMode: false,
    contentWidth: "default",
  });

  const [storageSummary, setStorageSummary] = useState<StorageSummary>({
    cloudBytes: 0,
    offlineBytes: 0,
    browserUsageBytes: null,
    browserQuotaBytes: null,
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");

  const loadStorage = useCallback(async (currentUser: User) => {
    const { data, error } = await supabase
      .from("tracks")
      .select("file_size")
      .eq("user_id", currentUser.id);

    const cloudBytes = error
      ? 0
      : (data || []).reduce((total, track) => total + (Number(track.file_size) || 0), 0);

    const estimate =
      typeof navigator !== "undefined" && navigator.storage?.estimate
        ? await navigator.storage.estimate()
        : null;

    setStorageSummary({
      cloudBytes,
      offlineBytes: readOfflineBytes(currentUser.id),
      browserUsageBytes: typeof estimate?.usage === "number" ? estimate.usage : null,
      browserQuotaBytes: typeof estimate?.quota === "number" ? estimate.quota : null,
    });
  }, []);

  useEffect(() => {
    async function checkUser() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.push("/login");
        return;
      }

      setUser(data.user);
      const { preferences } = await loadSyncedUserPreferences(supabase, data.user.id);
      setProfile(preferences.profile);
      setTheme(preferences.theme);
      applyThemeToDocument(preferences.theme);
      await loadStorage(data.user);

      setCheckingAuth(false);
    }

    void checkUser();
  }, [loadStorage, router]);

  async function saveProfile() {
    if (!user) {
      return;
    }

    const { error } = await saveSyncedUserPreferences(supabase, user.id, { profile });

    if (error) {
      setStatus(`Saved on this device. Cloud sync failed: ${error.message}`);
      return;
    }

    setStatus("Profile updated and synced.");
  }

  async function saveTheme(nextTheme: AppThemePreferences) {
    if (!user) {
      return;
    }

    setTheme(nextTheme);
    applyThemeToDocument(nextTheme);
    const { error } = await saveSyncedUserPreferences(supabase, user.id, { theme: nextTheme });

    if (error) {
      setStatus(`Saved on this device. Cloud sync failed: ${error.message}`);
      return;
    }

    setStatus("Theme preferences updated and synced.");
  }

  async function handleAvatarChange(file: File) {
    if (!file.type.startsWith("image/")) {
      setStatus("Profile picture must be an image.");
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    setProfile((current) => ({
      ...current,
      avatarDataUrl: dataUrl,
    }));
  }

  async function updatePassword() {
    if (!password || password.length < 6) {
      setStatus("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus(error.message);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setStatus("Password updated.");
  }

  async function shareProfile() {
    const url = `${window.location.origin}/library`;
    const shareText = `${profile.username || user?.email || "Music Locker user"}\n${profile.bio || "Check out my music locker profile."}\n${url}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Music Locker profile",
          text: profile.bio || "Check out my music locker profile.",
          url,
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
      }

      setStatus("Profile share link ready.");
    } catch {
      setStatus("Could not share profile right now.");
    }
  }

  if (checkingAuth) {
    return (
      <main className="app-shell min-h-screen text-[var(--app-text)]">
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-[var(--app-muted)]">Checking account...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell min-h-screen text-[var(--app-text)]">
      <Navbar />

      <section className="app-content px-6 py-10">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Account</h1>
            <p className="mt-3 text-[var(--app-muted)]">
              Profile, storage, password, and layout.
            </p>
          </div>
          <button
            type="button"
            onClick={() => user && void loadStorage(user)}
            className="rounded-full border border-[var(--app-border)] px-4 py-2 text-sm"
          >
            Refresh storage
          </button>
        </div>

        <div className="app-card p-6">
          <h2 className="text-lg font-semibold">Profile</h2>

          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              {profile.avatarDataUrl ? (
                <Image
                  src={profile.avatarDataUrl}
                  alt="Profile avatar"
                  width={48}
                  height={48}
                  unoptimized
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--app-border)] text-xs text-[var(--app-muted)]">
                  Avatar
                </div>
              )}

              <label className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm">
                Upload picture
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (event) => {
                    const selected = event.target.files?.[0];

                    if (selected) {
                      await handleAvatarChange(selected);
                    }
                  }}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm text-[var(--app-muted)]">Username</span>
              <input
                type="text"
                value={profile.username}
                autoComplete="off"
                name="music-locker-display-name"
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                className="app-input mt-1 w-full px-3 py-2"
              />
            </label>

            <label className="block">
              <span className="text-sm text-[var(--app-muted)]">Bio</span>
              <textarea
                value={profile.bio}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    bio: event.target.value,
                  }))
                }
                rows={3}
                autoComplete="off"
                name="music-locker-bio"
                className="app-input mt-1 w-full px-3 py-2"
              />
            </label>

            <label className="block">
              <span className="text-sm text-[var(--app-muted)]">Theme</span>
              <select
                value={theme.themeId}
                onChange={(event) =>
                  void saveTheme({
                    ...theme,
                    themeId: event.target.value as ThemeId,
                  })
                }
                className="app-input mt-1 w-full px-3 py-2"
              >
                {themeChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-[var(--app-muted)]">UI width</span>
              <select
                value={theme.contentWidth}
                onChange={(event) =>
                  void saveTheme({
                    ...theme,
                    contentWidth: event.target.value as AppThemePreferences["contentWidth"],
                  })
                }
                className="app-input mt-1 w-full px-3 py-2"
              >
                {widthChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-sm text-[var(--app-muted)]">Account email: {user?.email}</p>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void saveProfile()} className="app-button px-4 py-2 text-sm">
                Save
              </button>

              <button type="button" onClick={shareProfile} className="rounded-md border border-[var(--app-border)] px-4 py-2 text-sm">
                Share
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section className="app-card p-6">
            <h2 className="text-lg font-semibold">Storage</h2>
            <div className="mt-4 grid gap-3">
              <div className="rounded-lg border border-[var(--app-border)] p-4">
                <p className="text-xs text-[var(--app-muted)]">Cloud library</p>
                <p className="mt-1 text-2xl font-semibold text-white">{formatBytes(storageSummary.cloudBytes)}</p>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] p-4">
                <p className="text-xs text-[var(--app-muted)]">Downloaded offline</p>
                <p className="mt-1 text-2xl font-semibold text-white">{formatBytes(storageSummary.offlineBytes)}</p>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] p-4">
                <p className="text-xs text-[var(--app-muted)]">Browser storage</p>
                <p className="mt-1 text-sm text-white">
                  {formatBytes(storageSummary.browserUsageBytes)} used
                  {storageSummary.browserQuotaBytes !== null
                    ? ` of ${formatBytes(storageSummary.browserQuotaBytes)}`
                    : ""}
                </p>
              </div>
            </div>
          </section>

          <section className="app-card p-6">
            <h2 className="text-lg font-semibold">Change password</h2>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-sm text-[var(--app-muted)]">New password</span>
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  name="music-locker-new-password"
                  onChange={(event) => setPassword(event.target.value)}
                  className="app-input mt-1 w-full px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm text-[var(--app-muted)]">Confirm password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  name="music-locker-confirm-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="app-input mt-1 w-full px-3 py-2"
                />
              </label>
              <button
                type="button"
                onClick={() => void updatePassword()}
                className="app-button px-4 py-2 text-sm"
              >
                Update password
              </button>
            </div>
          </section>
        </div>

        {status && <p className="mt-5 text-sm text-[var(--app-muted)]">{status}</p>}
      </section>
    </main>
  );
}
