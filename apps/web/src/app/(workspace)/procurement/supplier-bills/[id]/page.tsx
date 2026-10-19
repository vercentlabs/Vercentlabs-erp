import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { SupplierBillDetailScreen } from "@/features/procurement/supplier-bills/screens/SupplierBillScreens";

export const metadata = { title: "Supplier bill" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <SupplierBillDetailScreen billId={id} />
      <RecordThreadPanel type="procurement.supplier_bill" id={id} />
    </div>
  );
}
