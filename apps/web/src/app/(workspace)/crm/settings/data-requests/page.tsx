import { requireWorkspace } from "@/core/session";
import { PrivacyRequestsSettingsScreen } from "@/features/crm/setup/privacy-requests/screens/PrivacyRequestsSettingsScreen";

export const metadata = { title: "Data Subject Requests" };

export default async function CrmDataSubjectRequestsSettingsPage() {
  await requireWorkspace();
  return <PrivacyRequestsSettingsScreen />;
}
