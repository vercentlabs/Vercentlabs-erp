import { LowStockAlertScreen } from "@/features/replenishment/screens/LowStockAlertScreen";

export const metadata = { title: "Low-Stock Alert" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LowStockAlertScreen alertId={id} />;
}
