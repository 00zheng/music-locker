import LibraryScreen from "@/components/LibraryScreen";

export default async function PlaylistPage({
  params,
}: {
  params: Promise<{ playlistId: string }>;
}) {
  const { playlistId } = await params;

  return <LibraryScreen playlistId={playlistId} />;
}
