import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { InvitationsScreen } from "@/features/settings/invitations/screens/InvitationsScreen";

export const metadata = { title: "Invitations" };

export default async function InvitationsSettingsPage() {
  const session = await requireWorkspace();
  return <InvitationsScreen canManage={hasSessionPermission(session, "users.manage")} />;
}
