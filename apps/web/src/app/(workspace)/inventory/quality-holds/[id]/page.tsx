import { QualityHoldDetailScreen } from "@/features/quality-holds/screens/QualityHoldDetailScreen";

export const metadata = { title: "Quality hold" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QualityHoldDetailScreen holdId={id} />;
}
