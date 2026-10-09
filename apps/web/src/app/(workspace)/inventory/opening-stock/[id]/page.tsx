import { OpeningStockDetailScreen } from "@/features/opening-stock/screens/OpeningStockDetailScreen";

export const metadata = { title: "Opening Stock" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  return <OpeningStockDetailScreen documentId={id} initialTab={tab ?? null} />;
}
