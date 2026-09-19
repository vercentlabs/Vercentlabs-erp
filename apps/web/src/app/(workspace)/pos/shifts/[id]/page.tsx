import { requireWorkspace } from "@/core/session";
import { PosShiftDetailScreen } from "@/features/pos/shifts/screens/PosShiftDetailScreen";

export const metadata = { title: "Shift" };

export default async function PosShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <PosShiftDetailScreen shiftId={id} />;
}
