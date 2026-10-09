import { StockCountFormScreen } from "@/features/stock-counts/screens/StockCountFormScreen";

export const metadata = { title: "Edit Stock Count" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StockCountFormScreen countId={id} />;
}
