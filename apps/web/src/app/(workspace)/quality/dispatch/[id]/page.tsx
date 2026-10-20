import { DispatchDetailScreen } from "@/features/quality/incoming/IncomingScreens";

export const metadata = { title: "Pre-Dispatch Inspection" };

export default async function QualityDispatchInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DispatchDetailScreen id={id} />;
}
