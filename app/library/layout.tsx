import LibraryScreen from "@/components/LibraryScreen";

export default function LibraryLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  void children;

  return <LibraryScreen />;
}
