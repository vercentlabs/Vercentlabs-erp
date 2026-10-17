import { RequirementDetailScreen } from "@/features/quality/control-points/QcpScreens";

export const metadata = { title: "Inspection Requirement" };

export default async function QualityRequirementPage({ params }: { params: Promise<{ obligationId: string }> }) {
  const { obligationId } = await params;
  return <RequirementDetailScreen obligationId={obligationId} />;
}
