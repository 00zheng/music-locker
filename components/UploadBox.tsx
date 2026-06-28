export default function UploadBox() {
  return (
    <section className="rounded-3xl border border-dashed border-zinc-700 bg-zinc-900/60 p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white">Upload music</h2>

        <p className="mt-2 text-sm text-zinc-400">
          Upload files to cloud storage
        </p>

        <label className="mt-6 inline-flex cursor-pointer rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-zinc-200">
          Choose audio files
          <input type="file" accept="audio/*" multiple className="hidden" />
        </label>

        <p className="mt-4 text-xs text-zinc-500">
          MP3, WAV, M4A, AAC, FLAC, OGG
        </p>
      </div>
    </section>
  );
}