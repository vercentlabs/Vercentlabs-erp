import { StockCountFormScreen } from "@/features/stock-counts/screens/StockCountFormScreen";

export const metadata = { title: "New Stock Count" };

// Opened from an item or warehouse, it starts as a count of that item or warehouse.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" && params[key] ? (params[key] as string) : undefined);
  return <StockCountFormScreen prefill={{ itemId: value("itemId"), warehouseId: value("warehouseId"), locationId: value("locationId"), batchId: value("batchId"), serialId: value("serialId") }} />;
}
