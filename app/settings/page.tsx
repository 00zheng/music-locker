"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

import Navbar from "@/components/Navbar";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    async function checkUser() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.push("/login");
        return;
      }

      setUser(data.user);
      setCheckingAuth(false);
    }

    checkUser();
  }, [router]);

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-neutral-950 text-white">
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-gray-400">Checking account...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <Navbar />

      <section className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold">Settings</h1>
          <p className="mt-3 text-gray-400">
            Manage your account and music locker preferences.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">Account</h2>

          <div className="mt-4 space-y-3 text-gray-300">
            <p>
              <span className="text-gray-500">Email:</span> {user?.email}
            </p>

            <p>
              <span className="text-gray-500">User ID:</span> {user?.id}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">Storage</h2>
          <p className="mt-3 text-gray-400">
            Storage usage, offline downloads, and music organization settings
            will be added in a later phase.
          </p>
        </div>
      </section>
    </main>
  );
}