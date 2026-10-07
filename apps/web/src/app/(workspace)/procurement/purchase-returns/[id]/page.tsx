import { PurchaseReturnDetailScreen } from "@/features/procurement/purchase-returns/screens/PurchaseReturnScreens";

export const metadata = { title: "Purchase return" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseReturnDetailScreen returnId={id} />;
}
