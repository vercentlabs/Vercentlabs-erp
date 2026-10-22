import { PaymentDetailScreen } from "@/features/sales/payments/PaymentDetailScreen";

export const metadata = { title: "Payment received" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetailScreen paymentId={id} />;
}
