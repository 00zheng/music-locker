"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-white transition hover:bg-zinc-800"
    >
      Log out
    </button>
  );
}