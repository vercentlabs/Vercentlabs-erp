import { requireWorkspace } from "@/core/session";
import { ChatChannelsScreen } from "@/features/crm/chat/ChatChannelsScreen";

export const metadata = { title: "Website chat" };

export default async function Page() {
  await requireWorkspace();
  return <ChatChannelsScreen />;
}
