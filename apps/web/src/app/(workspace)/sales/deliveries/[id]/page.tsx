import { DeliveryDetailScreen } from "@/features/sales/deliveries/screens/DeliveryDetailScreen";

export const metadata = { title: "Delivery" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeliveryDetailScreen deliveryId={id} />;
}
