import { requireWorkspace } from "@/core/session";
import { InboxScreen } from "@/features/crm/inbox/InboxScreen";

export const metadata = { title: "Inbox" };

export default async function Page() {
  await requireWorkspace();
  return <InboxScreen />;
}
