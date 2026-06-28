import Link from "next/link";

export default function Navbar() {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950 text-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold">
          Music Locker
        </Link>

        <div className="flex items-center gap-5 text-sm text-zinc-400">
          <Link href="/library" className="transition hover:text-white">
            Library
          </Link>

          <Link href="/login" className="transition hover:text-white">
            Login
          </Link>
        </div>
      </nav>
    </header>
  );
}