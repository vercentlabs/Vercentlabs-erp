import { StatutoryReportScreen } from "@/features/hr/screens/StatutoryScreens";

export const metadata = { title: "Statutory report" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StatutoryReportScreen runId={id} />;
}
