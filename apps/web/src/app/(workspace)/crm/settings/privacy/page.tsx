import { requireWorkspace } from "@/core/session";
import { PrivacyConsentScreen } from "@/features/crm/consent/screens/PrivacyConsentScreen";

export const metadata = { title: "Privacy and consent" };

export default async function Page() {
  await requireWorkspace();
  return <PrivacyConsentScreen />;
}
