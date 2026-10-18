import { requireWorkspace } from "@/core/session";
import { LeadScoringScreen } from "@/features/crm/settings/screens/LeadScoringScreen";

export const metadata = { title: "Lead scoring" };

export default async function Page() {
  await requireWorkspace();
  return <LeadScoringScreen />;
}
