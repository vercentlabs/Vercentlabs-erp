import { PaymentDetailScreen } from "@/features/accounting/payables/screens/PaymentDetailScreen";

export const metadata = { title: "Supplier payment" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetailScreen id={id} />;
}
