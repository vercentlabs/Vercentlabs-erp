import { SupplierBillFormScreen } from "@/features/procurement/supplier-bills/screens/SupplierBillFormScreen";

export const metadata = { title: "Edit supplier bill" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierBillFormScreen billId={id} />;
}
