import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <Navbar />

      <section className="mx-auto flex max-w-md flex-col px-6 py-20">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
          <h1 className="text-3xl font-bold">Sign in</h1>

          <p className="mt-3 text-sm text-zinc-400">
            placeholder
          </p>

          <form className="mt-8 space-y-4">
            <div>
              <label className="text-sm text-zinc-300">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-300">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-white"
              />
            </div>

            <button
              type="button"
              className="w-full rounded-xl bg-white px-4 py-3 font-medium text-black transition hover:bg-zinc-200"
            >
              Sign in
            </button>
          </form>

          <p className="mt-6 text-sm text-zinc-500">
            Do not have an account yet?{" "}
            <Link href="/signup" className="text-white underline">
              Sign up
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}