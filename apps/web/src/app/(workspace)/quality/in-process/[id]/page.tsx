import { InProcessDetailScreen } from "@/features/quality/incoming/IncomingScreens";

export const metadata = { title: "In-Process Inspection" };

export default async function QualityInProcessInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InProcessDetailScreen id={id} />;
}
