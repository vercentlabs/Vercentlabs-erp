import { requireWorkspace } from "@/core/session";
import { LeadScoringSettingsScreen } from "@/features/crm/settings/lead-scoring-models/screens/LeadScoringSettingsScreen";

export const metadata = { title: "Lead Scoring" };

export default async function CrmLeadScoringSettingsPage() {
  await requireWorkspace();
  return <LeadScoringSettingsScreen />;
}
