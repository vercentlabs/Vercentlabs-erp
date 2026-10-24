import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { VendorCreditDetailScreen } from "@/features/procurement/vendor-credits/screens/VendorCreditScreens";

export const metadata = { title: "Supplier credit note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <VendorCreditDetailScreen creditId={id} />
      <RecordThreadPanel type="procurement.supplier_credit" id={id} />
    </div>
  );
}
