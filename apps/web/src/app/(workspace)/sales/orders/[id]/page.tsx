import { SalesOrderDetailScreen } from "@/features/sales/orders/screens/SalesOrderDetailScreen";

export const metadata = { title: "Sales order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesOrderDetailScreen orderId={id} />;
}
