import { BatchDetailScreen } from "@/features/stock-balance/screens/TrackingDetailScreens";

export const metadata = { title: "Batch" };

export default async function Page({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <BatchDetailScreen batchId={batchId} />;
}
