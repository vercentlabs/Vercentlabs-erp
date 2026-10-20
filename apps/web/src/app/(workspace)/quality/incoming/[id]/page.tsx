import { IncomingDetailScreen } from "@/features/quality/incoming/IncomingScreens";

export const metadata = { title: "Incoming Inspection" };

export default async function QualityIncomingInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IncomingDetailScreen id={id} />;
}
