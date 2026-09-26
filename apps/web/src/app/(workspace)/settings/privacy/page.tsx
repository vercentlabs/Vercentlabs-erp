import { requireWorkspace } from "@/core/session";
import { PrivacyAdministrationScreen } from "@/features/settings/privacy/screens/PrivacyAdministrationScreen";

export const metadata = { title: "Privacy and retention" };

export default async function PrivacyPage() {
  await requireWorkspace();
  return <PrivacyAdministrationScreen />;
}
