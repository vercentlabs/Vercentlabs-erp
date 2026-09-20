import { SalesCustomerDetailScreen } from "@/features/sales/master/screens/SalesCustomerDetailScreen";

export const metadata = { title: "Customer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesCustomerDetailScreen customerId={id} />;
}
