import { PosReceiptScreen } from "@/features/pos/screens/PosReceiptScreen";

export const metadata = { title: "POS Receipt" };

export default async function PosReceiptPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  return <PosReceiptScreen saleId={saleId} />;
}
