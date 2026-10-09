import { ItemStockScreen } from "@/features/stock-balance/screens/ItemStockScreen";

export const metadata = { title: "Item Stock" };

export default async function Page({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return <ItemStockScreen itemId={itemId} />;
}
