import { AdjustmentFormScreen } from "@/features/adjustments/screens/AdjustmentFormScreen";

export const metadata = { title: "New Stock Adjustment" };

// Opened from a stock screen ("Adjust stock"), it starts with the item, warehouse and location already chosen.
export default async function Page({ searchParams }: { searchParams: Promise<{ itemId?: string; warehouseId?: string; locationId?: string }> }) {
  const { itemId, warehouseId, locationId } = await searchParams;
  const value = (entry: unknown) => (typeof entry === "string" && entry ? entry : undefined);
  return <AdjustmentFormScreen prefill={{ itemId: value(itemId), warehouseId: value(warehouseId), locationId: value(locationId) }} />;
}
