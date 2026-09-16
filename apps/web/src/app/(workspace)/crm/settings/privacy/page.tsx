import { requireWorkspace } from "@/core/session";
import { PrivacyAdministrationScreen } from "@/features/crm/settings/privacy/screens/PrivacyAdministrationScreen";

export const metadata = { title: "Privacy Administration" };

export default async function PrivacyAdministrationPage() {
  await requireWorkspace();
  return <PrivacyAdministrationScreen />;
}
