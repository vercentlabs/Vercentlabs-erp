import { GoodsIssueFormScreen } from "@/features/goods-issues/screens/GoodsIssueFormScreen";

export const metadata = { title: "New Goods Issue" };

// Opened from a stock, item, batch or serial screen, it starts with that item (and its warehouse, location, batch or serial) chosen.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" && params[key] ? (params[key] as string) : undefined);
  return <GoodsIssueFormScreen prefill={{ itemId: value("itemId"), warehouseId: value("warehouseId"), locationId: value("locationId"), batchId: value("batchId"), serialId: value("serialId") }} />;
}
