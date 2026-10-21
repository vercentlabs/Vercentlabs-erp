import { SupplierFormScreen } from "@/features/procurement/suppliers/screens/SupplierFormScreen";

export const metadata = { title: "Edit supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierFormScreen supplierId={id} />;
}
