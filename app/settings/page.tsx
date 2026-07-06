"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Image from "next/image";

import Navbar from "@/components/Navbar";
import { supabase } from "@/lib/supabase";
import {
  applyThemeToDocument,
  getAppThemePreferences,
  getUserProfilePreferences,
  setAppThemePreferences,
  setUserProfilePreferences,
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
  });

  const [status, setStatus] = useState("");

  useEffect(() => {
    async function checkUser() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.push("/login");
        return;
      }

      setUser(data.user);
      setProfile(getUserProfilePreferences(data.user.id));

      const savedTheme = getAppThemePreferences(data.user.id);
      setTheme(savedTheme);
      applyThemeToDocument(savedTheme);

      setCheckingAuth(false);
    }

    checkUser();
  }, [router]);

  function saveProfile() {
    if (!user) {
      return;
    }

    setUserProfilePreferences(user.id, profile);
    setStatus("Profile updated.");
  }

  function saveTheme(nextTheme: AppThemePreferences) {
    if (!user) {
      return;
    }

    setTheme(nextTheme);
    setAppThemePreferences(user.id, nextTheme);
    applyThemeToDocument(nextTheme);
    setStatus("Theme preferences updated.");
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

      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold">Settings</h1>
          <p className="mt-3 text-[var(--app-muted)]">
            Keep your profile and appearance simple.
          </p>
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
                className="app-input mt-1 w-full px-3 py-2"
              />
            </label>

            <label className="block">
              <span className="text-sm text-[var(--app-muted)]">Theme</span>
              <select
                value={theme.themeId}
                onChange={(event) =>
                  saveTheme({
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

            <p className="text-sm text-[var(--app-muted)]">Account email: {user?.email}</p>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveProfile} className="app-button px-4 py-2 text-sm">
                Save
              </button>

              <button type="button" onClick={shareProfile} className="rounded-md border border-[var(--app-border)] px-4 py-2 text-sm">
                Share
              </button>
            </div>
          </div>
        </div>

        {status && <p className="mt-5 text-sm text-[var(--app-muted)]">{status}</p>}
      </section>
    </main>
  );
}
