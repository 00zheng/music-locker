"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

import Navbar from "@/components/Navbar";
import { supabase } from "@/lib/supabase";
import MusicUploader from "../library/music-uploader";

export default function UploadPage() {
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
        <div className="mb-10">
          <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
            Upload
          </p>

          <h1 className="mt-3 text-4xl font-bold tracking-tight">
            Upload Music
          </h1>

          <p className="mt-4 max-w-2xl text-zinc-400">
            You are signed in as{" "}
            <span className="font-medium text-white">{user?.email}</span>.
            Upload songs to your private music locker.
          </p>
        </div>

        <MusicUploader showLibrary={false} />
      </section>
    </main>
  );
}