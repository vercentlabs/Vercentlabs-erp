import { requireWorkspace } from "@/core/session";
import { OutcomeReasonsSettingsScreen } from "@/features/crm/settings/lost-reasons/screens/OutcomeReasonsSettingsScreen";

export const metadata = { title: "Won / Lost Reasons" };

export default async function OutcomeReasonsSettingsPage() {
  await requireWorkspace();
  return <OutcomeReasonsSettingsScreen />;
}
