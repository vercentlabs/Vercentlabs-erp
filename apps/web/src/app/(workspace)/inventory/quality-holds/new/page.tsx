import { QualityHoldFormScreen } from "@/features/quality-holds/screens/QualityHoldFormScreen";

export const metadata = { title: "New quality hold" };

// Opened from a stock, batch or serial screen, it starts with that stock chosen.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" && params[key] ? (params[key] as string) : undefined);
  return <QualityHoldFormScreen prefill={{ itemId: value("itemId"), warehouseId: value("warehouseId"), locationId: value("locationId"), batchId: value("batchId"), serialId: value("serialId") }} />;
}
