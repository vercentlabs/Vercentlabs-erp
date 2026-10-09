import { SerialDetailScreen } from "@/features/stock-balance/screens/TrackingDetailScreens";

export const metadata = { title: "Serial number" };

export default async function Page({ params }: { params: Promise<{ serialId: string }> }) {
  const { serialId } = await params;
  return <SerialDetailScreen serialId={serialId} />;
}
