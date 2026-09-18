import { requireWorkspace } from "@/core/session";
import { PosDayEndReportDetailScreen } from "@/features/pos/day-end-reports/screens/PosDayEndReportDetailScreen";

export const metadata = { title: "Day-end (Z) Report" };

export default async function PosDayEndReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <PosDayEndReportDetailScreen reportId={id} />;
}
