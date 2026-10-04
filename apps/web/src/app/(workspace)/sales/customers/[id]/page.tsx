import { CustomerDetailScreen } from "@/features/sales/customers/screens/CustomerDetailScreen";

export const metadata = { title: "Customer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetailScreen key={id} customerId={id} />;
}
