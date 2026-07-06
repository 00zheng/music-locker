"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import Navbar from "@/components/Navbar";
import { supabase } from "@/lib/supabase";
import {
  loadSyncedUserPreferences,
  saveSyncedUserPreferences,
  type UserProfilePreferences,
} from "@/lib/user-prefs";

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

function ProfileIcon({
  name,
  className = "h-4 w-4",
}: {
  name: "camera" | "save" | "storage" | "lock" | "refresh";
  className?: string;
}) {
  const paths = {
    camera: (
      <>
        <path d="M14.5 5 13 3H9L7.5 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4.5Z" />
        <circle cx="12" cy="12" r="3.5" />
      </>
    ),
    save: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </>
    ),
    storage: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
        <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
    refresh: (
      <>
        <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
        <path d="M3 21v-5h5" />
        <path d="M3 12A9 9 0 0 1 18.4 5.6L21 8" />
        <path d="M21 3v5h-5" />
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

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [profile, setProfile] = useState<UserProfilePreferences>({
    username: "",
    bio: "",
    avatarDataUrl: null,
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
      await loadStorage(data.user);
      setCheckingAuth(false);
    }

    void checkUser();
  }, [loadStorage, router]);

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

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

  async function saveProfile() {
    if (!user) {
      return;
    }

    const { error } = await saveSyncedUserPreferences(supabase, user.id, { profile });

    if (error) {
      setStatus(`Saved on this device. Cloud sync failed: ${error.message}`);
      return;
    }

    window.dispatchEvent(new Event("music-locker:profile-updated"));
    setStatus("Profile updated and synced.");
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
          <p className="text-sm text-[var(--app-muted)]">Checking account...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell min-h-screen pb-24 text-[var(--app-text)]">
      <Navbar />

      <section className="mx-auto max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-[var(--app-muted)]">{user?.email}</p>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">Profile</h1>
          </div>
          <button
            type="button"
            onClick={() => user && void loadStorage(user)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--app-border)] px-4 text-sm text-[var(--app-text)]"
          >
            <ProfileIcon name="refresh" />
            Refresh storage
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
          <section className="app-card p-5 sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <label className="group relative h-28 w-28 shrink-0 cursor-pointer overflow-hidden rounded-full border border-[var(--app-border)] bg-[#151515]">
                {profile.avatarDataUrl ? (
                  <img src={profile.avatarDataUrl} alt="Profile avatar" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xs text-[var(--app-muted)]">
                    Avatar
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                  <ProfileIcon name="camera" className="h-5 w-5" />
                </span>
                <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
              </label>

              <div className="min-w-0 flex-1 space-y-4">
                <label className="block">
                  <span className="text-sm text-[var(--app-muted)]">Display name</span>
                  <input
                    value={profile.username}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        username: event.target.value,
                      }))
                    }
                    className="app-input mt-1 w-full px-3 py-2 text-sm"
                    placeholder="Your name"
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
                    className="app-input mt-1 w-full px-3 py-2 text-sm"
                    placeholder="A short note for your profile"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black"
                >
                  <ProfileIcon name="save" />
                  Save profile
                </button>
              </div>
            </div>
          </section>

          <section className="app-card p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-2">
              <ProfileIcon name="storage" className="h-5 w-5 text-white" />
              <h2 className="text-lg font-semibold text-white">Storage</h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-lg border border-[var(--app-border)] p-4">
                <p className="text-xs text-[var(--app-muted)]">Cloud library</p>
                <p className="mt-1 text-2xl font-semibold text-white">{formatBytes(storageSummary.cloudBytes)}</p>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] p-4">
                <p className="text-xs text-[var(--app-muted)]">Downloaded offline</p>
                <p className="mt-1 text-2xl font-semibold text-white">{formatBytes(storageSummary.offlineBytes)}</p>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] p-4 sm:col-span-2 lg:col-span-1">
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

          <section className="app-card p-5 sm:p-6 lg:col-span-2">
            <div className="mb-5 flex items-center gap-2">
              <ProfileIcon name="lock" className="h-5 w-5 text-white" />
              <h2 className="text-lg font-semibold text-white">Change password</h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block">
                <span className="text-sm text-[var(--app-muted)]">New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="app-input mt-1 w-full px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-sm text-[var(--app-muted)]">Confirm password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="app-input mt-1 w-full px-3 py-2 text-sm"
                />
              </label>

              <button
                type="button"
                onClick={() => void updatePassword()}
                className="inline-flex h-10 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-black"
              >
                Update
              </button>
            </div>
          </section>
        </div>

        {status ? <p className="mt-5 text-sm text-[var(--app-muted)]">{status}</p> : null}
      </section>
    </main>
  );
}
