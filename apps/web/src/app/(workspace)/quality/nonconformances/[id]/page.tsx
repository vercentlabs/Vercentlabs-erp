import { NonconformanceDetailScreen } from "@/features/quality/nonconformance/NcScreens";

export const metadata = { title: "Nonconformance" };

export default async function QualityNonconformancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NonconformanceDetailScreen id={id} />;
}
