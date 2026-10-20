import { Suspense } from "react";

import { ExpenseDetailScreen } from "@/features/accounting/expenses/screens/ExpenseDetailScreen";

export const metadata = { title: "Expense" };

// Suspense: the record reads a "saved but not submitted" note from the URL.
export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ExpenseDetailScreen id={id} /></Suspense>;
}
