import { requireWorkspace } from "@/core/session";
import { ZReportScreen } from "@/features/pos/day-end/screens/ZReportScreen";

export const metadata = { title: "Z Report" };

export default async function PosZReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  await requireWorkspace();
  const { reportId } = await params;
  return <ZReportScreen reportId={reportId} />;
}
