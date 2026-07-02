"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.push("/library");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
      <p className="text-gray-400">Opening music-locker...</p>
    </main>
  );
}