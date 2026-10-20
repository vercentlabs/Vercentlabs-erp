import { notFound } from "next/navigation";

import { StatementScreen } from "@/features/accounting/ledgers/screens/StatementScreen";

export const metadata = { title: "Statement" };

// /accounting/statements/customer/<id> or /accounting/statements/supplier/<id>.
export default async function StatementPage({ params }: { params: Promise<{ side: string; partyId: string }> }) {
  const { side, partyId } = await params;
  if (side !== "customer" && side !== "supplier") notFound();
  return <StatementScreen side={side === "customer" ? "receivable" : "payable"} partyId={partyId} />;
}
