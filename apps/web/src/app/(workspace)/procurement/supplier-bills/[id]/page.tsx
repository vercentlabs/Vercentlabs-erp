import { SupplierBillDetailScreen } from "@/features/procurement/supplier-bills/screens/SupplierBillScreens";

export const metadata = { title: "Supplier bill" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierBillDetailScreen billId={id} />;
}
