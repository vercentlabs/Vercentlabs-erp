import { StockCountDetailScreen } from "@/features/stock-counts/screens/StockCountDetailScreen";

export const metadata = { title: "Stock Count" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StockCountDetailScreen countId={id} />;
}
