import Link from "next/link";
import Navbar from "@/components/Navbar";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="app-shell min-h-screen text-[var(--app-text)]">
      <Navbar />

      <section className="mx-auto flex max-w-md flex-col px-6 py-20">
        <div className="app-card p-8">
          <h1 className="text-3xl font-bold">Sign in</h1>

          <p className="mt-3 text-sm text-[var(--app-muted)]">
            Sign in to access your private music locker.
          </p>

          <LoginForm />

          <p className="mt-6 text-sm text-[var(--app-muted)]">
            Do not have an account yet?{" "}
            <Link href="/signup" className="underline">
              Sign up
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}