import { InspectionDetailScreen } from "@/features/quality/screens/InspectionScreens";
import { InspectionRejectionsPanel } from "@/features/procurement/purchase-orders/screens/RejectionScreens";

export const metadata = { title: "Inspection" };

// The inspection, and — for goods held on a goods receipt — the receiving rejections its decision opened (owned by Procurement, shown here).
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <InspectionDetailScreen id={id} />
      <InspectionRejectionsPanel inspectionId={id} />
    </div>
  );
}
