import { ControlPointDetailScreen } from "@/features/quality/control-points/QcpScreens";

export const metadata = { title: "Quality Control Point" };

export default async function QualityControlPointPage({ params }: { params: Promise<{ pointId: string }> }) {
  const { pointId } = await params;
  return <ControlPointDetailScreen pointId={pointId} />;
}
