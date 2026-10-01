import { requireWorkspace } from "@/core/session";
import { QualificationAndPlaybooksSettingsScreen } from "@/features/crm/setup/qualification-and-playbooks/screens/QualificationAndPlaybooksSettingsScreen";

export const metadata = { title: "Qualification & Playbooks" };

export default async function CrmQualificationAndPlaybooksSettingsPage() {
  await requireWorkspace();
  return <QualificationAndPlaybooksSettingsScreen />;
}
