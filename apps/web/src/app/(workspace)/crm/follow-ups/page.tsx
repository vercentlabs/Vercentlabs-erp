import { requireWorkspace } from "@/core/session";
import { FollowUpListScreen } from "@/features/crm/follow-ups/screens/FollowUpListScreen";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage() {
  await requireWorkspace();
  return <FollowUpListScreen />;
}
