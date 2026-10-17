import { Suspense } from "react";

import { ExpensesScreen } from "@/features/projects/expenses/ExpenseScreens";

export const metadata = { title: "Project Expenses" };

export default function Page() {
  return <Suspense><ExpensesScreen /></Suspense>;
}
