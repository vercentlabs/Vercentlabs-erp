import { requireWorkspace } from "@/core/session";
import { RecurringPlansScreen } from "@/features/crm/settings/screens/RecurringPlansScreen";

export const metadata = { title: "Recurring plans" };

export default async function Page() {
  await requireWorkspace();
  return <RecurringPlansScreen />;
}
