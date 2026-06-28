type SongCardProps = {
  title: string;
  artist: string;
  fileType: string;
  size: string;
  offline: boolean;
};

export default function SongCard({
  title,
  artist,
  fileType,
  size,
  offline,
}: SongCardProps) {
  return (
    <article className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-zinc-400">{artist}</p>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
            <span className="rounded-full bg-zinc-800 px-3 py-1">
              {fileType}
            </span>

            <span className="rounded-full bg-zinc-800 px-3 py-1">{size}</span>

            <span className="rounded-full bg-zinc-800 px-3 py-1">
              {offline ? "Offline saved" : "Online only"}
            </span>
          </div>
        </div>

        <button className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-white transition hover:bg-zinc-800">
          Save offline
        </button>
      </div>

      <div className="mt-5 rounded-2xl bg-zinc-950 p-4">
        <p className="text-sm text-zinc-500">
          Audio player will appear here after real uploads are added.
        </p>
      </div>
    </article>
  );
}