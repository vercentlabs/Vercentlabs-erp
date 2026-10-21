import { ExpenseFormScreen } from "@/features/accounting/expenses/screens/ExpenseFormScreen";

export const metadata = { title: "Edit expense" };

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExpenseFormScreen id={id} />;
}
