import { requireWorkspace } from "@/core/session";
import { WhatsAppSettingsScreen } from "@/features/crm/whatsapp/screens/WhatsAppSettingsScreen";

export const metadata = { title: "WhatsApp" };

export default async function Page() {
  await requireWorkspace();
  return <WhatsAppSettingsScreen />;
}
