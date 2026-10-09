import { StockCountSheetScreen } from "@/features/stock-counts/screens/StockCountSheetScreen";

export const metadata = { title: "Count Sheet" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StockCountSheetScreen countId={id} />;
}
