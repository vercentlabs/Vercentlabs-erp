import { WarehouseDetailScreen } from "@/features/warehouses/screens/WarehouseDetailScreen";

export const metadata = { title: "Warehouse" };

export default async function Page({ params, searchParams }: { params: Promise<{ warehouseId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { warehouseId } = await params;
  const { tab } = await searchParams;
  return <WarehouseDetailScreen warehouseId={warehouseId} initialTab={tab ?? null} />;
}
