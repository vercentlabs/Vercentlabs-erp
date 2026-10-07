import { PurchaseReturnFormScreen } from "@/features/procurement/purchase-returns/screens/PurchaseReturnFormScreen";

export const metadata = { title: "Edit purchase return" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseReturnFormScreen returnId={id} />;
}
