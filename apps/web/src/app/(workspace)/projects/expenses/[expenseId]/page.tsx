import { Suspense } from "react";

import { ExpenseDetailScreen } from "@/features/projects/expenses/ExpenseScreens";

export const metadata = { title: "Expense" };

export default async function Page({ params }: { params: Promise<{ expenseId: string }> }) {
  const { expenseId } = await params;
  return <Suspense><ExpenseDetailScreen expenseId={expenseId} /></Suspense>;
}
