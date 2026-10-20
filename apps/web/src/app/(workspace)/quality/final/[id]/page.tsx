import { FinalDetailScreen } from "@/features/quality/incoming/IncomingScreens";

export const metadata = { title: "Final Inspection" };

export default async function QualityFinalInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FinalDetailScreen id={id} />;
}
