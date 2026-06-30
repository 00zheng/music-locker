import Link from "next/link";
import Navbar from "@/components/Navbar";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <Navbar />

      <section className="mx-auto flex max-w-md flex-col px-6 py-20">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
          <h1 className="text-3xl font-bold">Sign in</h1>

          <p className="mt-3 text-sm text-zinc-400">
            Sign in to access your private music locker.
          </p>

          <LoginForm />

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