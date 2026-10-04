import { requireWorkspace } from "@/core/session";
import { FollowUpListScreen } from "@/features/crm/follow-ups/screens/FollowUpListScreen";

export const metadata = { title: "Follow-ups" };

// CRM Follow-ups. Due Today is the default; ?view=overdue | upcoming | mine | … opens another view.
export default async function Page() {
  await requireWorkspace();
  return <FollowUpListScreen />;
}
