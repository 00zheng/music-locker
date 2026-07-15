import Navbar from "@/components/Navbar";

export default function SettingsLoading() {
  return (
    <main className="app-shell min-h-screen text-[var(--app-text)]">
      <Navbar />
      <section className="app-content app-page-enter px-6 py-10">
        <div className="mb-8 h-9 w-40 rounded-lg bg-[var(--app-glass)]" />
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="app-card p-6">
              <div className="h-5 w-36 rounded bg-[var(--app-glass)]" />
              <div className="mt-5 grid gap-3">
                <div className="h-14 rounded-lg bg-[var(--app-glass)]" />
                <div className="h-14 rounded-lg bg-[var(--app-glass)]" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
