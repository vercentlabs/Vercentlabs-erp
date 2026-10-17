import { SpecificationDetailScreen } from "@/features/quality/specifications/SpecScreens";

export const metadata = { title: "Inspection Specification" };

export default async function QualitySpecificationPage({ params }: { params: Promise<{ specId: string }> }) {
  const { specId } = await params;
  return <SpecificationDetailScreen specId={specId} />;
}
