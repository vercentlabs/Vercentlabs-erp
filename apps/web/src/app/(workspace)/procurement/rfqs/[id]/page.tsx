import { RfqDetailScreen } from "@/features/procurement/rfqs/RfqScreens";

export const metadata = { title: "RFQ" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RfqDetailScreen rfqId={id} />;
}
