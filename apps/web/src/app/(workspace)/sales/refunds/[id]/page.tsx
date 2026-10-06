import { CustomerRefundDetailScreen } from "@/features/accounting/refunds/screens/CustomerRefundDetailScreen";

export const metadata = { title: "Refund" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerRefundDetailScreen refundId={id} basePath="/sales/refunds" />;
}
