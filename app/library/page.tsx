import Navbar from "@/components/Navbar";
import UploadBox from "@/components/UploadBox";
import SongCard from "@/components/SongCard";

const mockSongs = [
  {
    id: 1,
    title: "Demo",
    artist: "itchy",
    fileType: "MP3",
    size: "7.4 MB",
    offline: false,
  },
  {
    id: 2,
    title: "Piano",
    artist: "finger",
    fileType: "M4A",
    size: "4.1 MB",
    offline: true,
  },
  {
    id: 3,
    title: "Beat",
    artist: "192",
    fileType: "WAV",
    size: "22.8 MB",
    offline: false,
  },
];

export default function LibraryPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <Navbar />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
            Your library
          </p>

          <h1 className="mt-3 text-4xl font-bold tracking-tight">
            Music Locker
          </h1>

          <p className="mt-4 max-w-2xl text-zinc-400">
            uploaded songs will appear here.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
          <UploadBox />

          <section className="space-y-4">
            {mockSongs.map((song) => (
              <SongCard
                key={song.id}
                title={song.title}
                artist={song.artist}
                fileType={song.fileType}
                size={song.size}
                offline={song.offline}
              />
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}