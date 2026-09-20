import { SalesOrderFormScreen } from "@/features/sales/orders/screens/SalesOrderFormScreen";

export const metadata = { title: "Amend sales order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesOrderFormScreen orderId={id} />;
}
