import { BomImpactScreen } from "@/features/manufacturing/boms/screens/BomImpactScreen";

export const metadata = { title: "BOM revision impact" };

export default async function Page({ params }: { params: Promise<{ bomId: string; revisionId: string }> }) {
  const { bomId, revisionId } = await params;
  return <BomImpactScreen bomId={bomId} revisionId={revisionId} />;
}
