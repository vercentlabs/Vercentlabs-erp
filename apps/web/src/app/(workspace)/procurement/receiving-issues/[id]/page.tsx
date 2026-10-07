import { RejectionDetailScreen } from "@/features/procurement/purchase-orders/screens/RejectionScreens";

export const metadata = { title: "Receiving rejection" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RejectionDetailScreen rejectionId={id} />;
}
