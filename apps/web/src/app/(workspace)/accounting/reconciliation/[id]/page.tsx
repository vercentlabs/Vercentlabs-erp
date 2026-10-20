import { ReconciliationScreen } from "@/features/accounting/banking/screens/ReconciliationScreen";

export const metadata = { title: "Bank statement reconciliation" };

export default async function StatementReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReconciliationScreen id={id} />;
}
