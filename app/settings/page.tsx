"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

import Navbar from "@/components/Navbar";
import LogoutButton from "@/components/LogoutButton";
import { supabase } from "@/lib/supabase";
import {
  applyThemeToDocument,
  loadSyncedUserPreferences,
  saveSyncedUserPreferences,
  type AppThemePreferences,
  type ThemeId,
} from "@/lib/user-prefs";

const appearanceChoices: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: "nocturne", label: "Dark", description: "Black app background" },
  { id: "light", label: "Light", description: "Bright app background" },
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

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

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
      setTheme(preferences.theme);
      applyThemeToDocument(preferences.theme);
      await loadStorage(data.user);

      setCheckingAuth(false);
    }

    void checkUser();
  }, [loadStorage, router]);

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
    <main className="app-shell app-page-enter min-h-screen text-[var(--app-text)]">
      <Navbar />

      <section className="app-content px-6 py-10">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Settings</h1>
            <p className="mt-3 text-[var(--app-muted)]">
              Storage, appearance, password, and sign out.
            </p>
          </div>
          <button
            type="button"
            onClick={() => user && void loadStorage(user)}
            className="rounded-full border border-[var(--app-border)] px-4 py-2 text-sm transition hover:bg-[var(--app-glass)]"
          >
            Refresh storage
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section id="appearance" className="app-card scroll-mt-24 p-6">
            <h2 className="text-lg font-semibold">Appearance</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {appearanceChoices.map((choice) => {
                const isSelected =
                  choice.id === "light" ? theme.themeId === "light" : theme.themeId !== "light";

                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() =>
                      void saveTheme({
                        ...theme,
                        themeId: choice.id,
                      })
                    }
                    className={`rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? "border-[var(--app-accent)] bg-[var(--app-glass-strong)]"
                        : "border-[var(--app-border)] hover:bg-[var(--app-glass)]"
                    }`}
                    aria-pressed={isSelected}
                  >
                    <span className="block text-sm font-semibold text-[var(--app-text)]">
                      {choice.label}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--app-muted)]">
                      {choice.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section id="storage" className="app-card scroll-mt-24 p-6">
            <h2 className="text-lg font-semibold">Storage</h2>
            <div className="mt-4 grid gap-3">
              <div className="rounded-lg border border-[var(--app-border)] p-4">
                <p className="text-xs text-[var(--app-muted)]">Cloud library</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--app-text)]">{formatBytes(storageSummary.cloudBytes)}</p>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] p-4">
                <p className="text-xs text-[var(--app-muted)]">Downloaded offline</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--app-text)]">{formatBytes(storageSummary.offlineBytes)}</p>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] p-4">
                <p className="text-xs text-[var(--app-muted)]">Browser storage</p>
                <p className="mt-1 text-sm text-[var(--app-text)]">
                  {formatBytes(storageSummary.browserUsageBytes)} used
                  {storageSummary.browserQuotaBytes !== null
                    ? ` of ${formatBytes(storageSummary.browserQuotaBytes)}`
                    : ""}
                </p>
              </div>
            </div>
          </section>

          <section id="password" className="app-card scroll-mt-24 p-6">
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

          <section id="sign-out" className="app-card scroll-mt-24 p-6">
            <h2 className="text-lg font-semibold">Sign out</h2>
            <p className="mt-2 text-sm text-[var(--app-muted)]">{user?.email}</p>
            <div className="mt-4">
              <LogoutButton />
            </div>
          </section>
        </div>

        {status && <p className="mt-5 text-sm text-[var(--app-muted)]">{status}</p>}
      </section>
    </main>
  );
}
