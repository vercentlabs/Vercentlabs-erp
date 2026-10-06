import { SupplierDetailScreen } from "@/features/procurement/suppliers/screens/SupplierDetailScreen";

export const metadata = { title: "Supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierDetailScreen supplierId={id} />;
}
