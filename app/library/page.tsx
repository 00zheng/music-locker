"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

import Navbar from "@/components/Navbar";
import UploadBox from "@/components/UploadBox";
import SongCard from "@/components/SongCard";
import LogoutButton from "@/components/LogoutButton";
import { supabase } from "@/lib/supabase";

const mockSongs = [
  {
    id: 1,
    title: "Late Night Demo",
    artist: "Gavin",
    fileType: "MP3",
    size: "7.4 MB",
    offline: false,
  },
  {
    id: 2,
    title: "Piano Idea",
    artist: "Gavin",
    fileType: "M4A",
    size: "4.1 MB",
    offline: true,
  },
  {
    id: 3,
    title: "Beat Draft",
    artist: "Friend",
    fileType: "WAV",
    size: "22.8 MB",
    offline: false,
  },
];

export default function LibraryPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [isCheckingUser, setIsCheckingUser] = useState(true);

  useEffect(() => {
    async function checkUser() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.push("/login");
        return;
      }

      setUser(data.user);
      setIsCheckingUser(false);
    }

    checkUser();
  }, [router]);

  if (isCheckingUser) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <Navbar />

        <section className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-zinc-400">Checking login...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <Navbar />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
              Your library
            </p>

            <h1 className="mt-3 text-4xl font-bold tracking-tight">
              Music Locker
            </h1>

            <p className="mt-4 max-w-2xl text-zinc-400">
              You are signed in as{" "}
              <span className="font-medium text-white">{user?.email}</span>.
              Later, this page will show your real uploaded songs from
              Supabase.
            </p>
          </div>

          <LogoutButton />
        </div>

        <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
          <UploadBox />

          <section className="space-y-4">
            {mockSongs.map((song) => (
              <SongCard
                key={song.id}
                title={song.title}
                artist={song.artist}
                fileType={song.fileType}
                size={song.size}
                offline={song.offline}
              />
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}