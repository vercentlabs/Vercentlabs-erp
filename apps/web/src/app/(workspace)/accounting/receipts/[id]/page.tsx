import { ReceiptDetailScreen } from "@/features/accounting/receivables/screens/ReceiptDetailScreen";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptDetailScreen id={id} />;
}
