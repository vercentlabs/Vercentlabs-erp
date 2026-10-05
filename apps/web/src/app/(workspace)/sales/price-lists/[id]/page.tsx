import { PriceListDetailScreen } from "@/features/sales/price-lists/screens/PriceListDetailScreen";

export const metadata = { title: "Price list" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PriceListDetailScreen key={id} priceListId={id} />;
}
