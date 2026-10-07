import { ReportScreen } from "@/features/procurement/insights/ReportScreens";

export const metadata = { title: "Procurement Report" };

export default async function Page({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  return <ReportScreen reportKey={report} />;
}
