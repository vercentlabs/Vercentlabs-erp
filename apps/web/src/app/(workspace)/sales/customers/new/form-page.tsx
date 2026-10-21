import { CustomerFormScreen } from "@/features/sales/customers/screens/CustomerFormScreen";

export const metadata = { title: "New customer" };

export default async function Page({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  const { accountId } = await searchParams;
  return <CustomerFormScreen key={accountId ?? "new"} accountId={accountId} />;
}
