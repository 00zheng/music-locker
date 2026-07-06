"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.push("/library");
  }, [router]);

  return (
    <main className="app-shell flex min-h-screen items-center justify-center text-[var(--app-text)]">
      <p className="text-[var(--app-muted)]">Opening music-locker...</p>
    </main>
  );
}