import { CashierFormScreen } from "@/features/pos/cashiers/screens/CashierFormScreen";

export const metadata = { title: "New cashier" };

export default async function Page({ searchParams }: { searchParams: Promise<{ outletId?: string }> }) {
  const { outletId } = await searchParams;
  return <CashierFormScreen outletId={outletId ?? null} />;
}
