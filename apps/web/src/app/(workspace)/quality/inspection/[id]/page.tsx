import { InspectionDetailScreen } from "@/features/quality/screens/InspectionScreens";

export const metadata = { title: "Inspection" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InspectionDetailScreen id={id} />;
}
