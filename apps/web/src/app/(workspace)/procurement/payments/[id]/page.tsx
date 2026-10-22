import { SupplierPaymentDetailScreen } from "@/features/procurement/payments/SupplierPaymentScreens";

export const metadata = { title: "Supplier payment" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierPaymentDetailScreen paymentId={id} />;
}
