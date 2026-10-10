import { CashierDetailScreen } from "@/features/pos/cashiers/screens/CashierDetailScreen";

export const metadata = { title: "Cashier" };

export default async function Page({ params, searchParams }: { params: Promise<{ cashierId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { cashierId } = await params;
  const { tab } = await searchParams;
  return <CashierDetailScreen cashierId={cashierId} initialTab={tab ?? null} />;
}
