import { requireWorkspace } from "@/core/session";
import { DealCalendarScreen } from "@/features/crm/opportunities/screens/DealCalendarScreen";

export const metadata = { title: "Deal calendar" };

export default async function Page() {
  await requireWorkspace();
  return <DealCalendarScreen />;
}
