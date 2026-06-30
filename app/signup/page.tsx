import Link from "next/link";
import Navbar from "@/components/Navbar";
import SignupForm from "@/components/SignupForm";

export default function SignupPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <Navbar />

      <section className="mx-auto flex max-w-md flex-col px-6 py-20">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
          <h1 className="text-3xl font-bold">Create account</h1>

          <p className="mt-3 text-sm text-zinc-400">
            Create an account so your music library can sync across your
            devices later.
          </p>

          <SignupForm />

          <p className="mt-6 text-sm text-zinc-500">
            Already have an account?{" "}
            <Link href="/login" className="text-white underline">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}