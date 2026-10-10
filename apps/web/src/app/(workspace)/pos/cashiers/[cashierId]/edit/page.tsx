import { CashierFormScreen } from "@/features/pos/cashiers/screens/CashierFormScreen";

export const metadata = { title: "Edit cashier" };

export default async function Page({ params }: { params: Promise<{ cashierId: string }> }) {
  const { cashierId } = await params;
  return <CashierFormScreen cashierId={cashierId} />;
}
