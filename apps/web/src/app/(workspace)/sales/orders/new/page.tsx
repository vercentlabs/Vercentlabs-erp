import { SalesOrderFormScreen } from "@/features/sales/orders/screens/SalesOrderFormScreen";

export const metadata = { title: "New sales order" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const { customer } = await searchParams;
  return <SalesOrderFormScreen initialPartyId={customer} />;
}
