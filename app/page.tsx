import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 text-center">
        <p className="mb-4 rounded-full border border-zinc-800 px-4 py-2 text-sm text-zinc-400">
          Private music locker for your own files
        </p>

        <h1 className="max-w-3xl text-5xl font-bold tracking-tight sm:text-7xl">
          Upload your music once. Listen from anywhere.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
          A small personal music website where you can upload audio files from
          your phone or computer, sync them across devices, and later save songs
          for offline playback.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <Link
            href="/library"
            className="rounded-full bg-white px-6 py-3 font-medium text-black transition hover:bg-zinc-200"
          >
            Open Library
          </Link>

          <Link
            href="/login"
            className="rounded-full border border-zinc-700 px-6 py-3 font-medium text-white transition hover:bg-zinc-900"
          >
            Sign In
          </Link>
        </div>
      </section>
    </main>
  );
}