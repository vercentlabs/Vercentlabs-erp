import { SharedImportScreen } from "@/features/settings/data-import/SharedImportScreen";

export const metadata = { title: "Import" };

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <SharedImportScreen importerKey={decodeURIComponent(key)} />;
}
