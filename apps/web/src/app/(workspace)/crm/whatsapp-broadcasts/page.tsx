import { requireWorkspace } from "@/core/session";
import { WhatsAppBroadcastsScreen } from "@/features/crm/whatsapp-broadcasts/WhatsAppBroadcastsScreen";

export const metadata = { title: "WhatsApp broadcasts" };

export default async function Page() {
  await requireWorkspace();
  return <WhatsAppBroadcastsScreen />;
}
