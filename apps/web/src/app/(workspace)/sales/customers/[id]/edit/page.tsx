import { CustomerFormScreen } from "@/features/sales/customers/screens/CustomerFormScreen";

export const metadata = { title: "Edit customer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerFormScreen key={id} customerId={id} />;
}
