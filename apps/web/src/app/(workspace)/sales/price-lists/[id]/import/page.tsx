import { PriceImportScreen } from "@/features/sales/price-lists/screens/PriceImportScreen";

export const metadata = { title: "Import prices" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PriceImportScreen key={id} priceListId={id} />;
}
