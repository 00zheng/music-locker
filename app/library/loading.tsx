import Navbar from "@/components/Navbar";

export default function LibraryLoading() {
  return (
    <>
      <Navbar />
      <main className="app-shell min-h-screen px-6 py-8 text-[var(--app-text)]">
        <div className="app-content app-page-enter">
          <div className="mb-8 h-8 w-48 rounded-lg bg-[var(--app-glass)]" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="app-card p-3">
                <div className="aspect-square rounded-md bg-[var(--app-glass)]" />
                <div className="mt-3 h-4 w-3/4 rounded bg-[var(--app-glass)]" />
                <div className="mt-2 h-3 w-1/3 rounded bg-[var(--app-glass)]" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
