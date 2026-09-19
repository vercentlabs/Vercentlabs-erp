import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { UsersScreen } from "@/features/settings/users/screens/UsersScreen";

export const metadata = { title: "Users" };

export default async function UsersSettingsPage() {
  const session = await requireWorkspace();
  return <UsersScreen canManage={hasSessionPermission(session, "users.manage")} currentUserId={session.userId} />;
}
