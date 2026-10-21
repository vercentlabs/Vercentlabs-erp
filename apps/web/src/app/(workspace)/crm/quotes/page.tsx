import { requireWorkspace } from "@/core/session";
import { QuotesListScreen } from "@/features/crm/quotes/QuotesListScreen";

export const metadata = { title: "Quotations" };

export default async function Page() {
  await requireWorkspace();
  return <QuotesListScreen />;
}
