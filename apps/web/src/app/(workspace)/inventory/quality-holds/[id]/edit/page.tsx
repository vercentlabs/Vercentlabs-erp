import { QualityHoldFormScreen } from "@/features/quality-holds/screens/QualityHoldFormScreen";

export const metadata = { title: "Edit quality hold" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QualityHoldFormScreen holdId={id} />;
}
