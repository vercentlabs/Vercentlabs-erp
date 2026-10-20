import { BankAccountDetailScreen } from "@/features/accounting/banking/screens/BankAccountDetailScreen";

export const metadata = { title: "Bank or cash account" };

export default async function BankAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BankAccountDetailScreen id={id} />;
}
