import { hasSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { UsersScreen } from "@/features/settings/users/screens/UsersScreen";

export const metadata = { title: "Users" };

// Exact abilities, not one broad "canManage" flag: viewing, managing a
// user's status/scope, and assigning roles are separate permissions. UX
// only — every action is re-checked on the server.
export default async function UsersSettingsPage() {
  const session = await requireWorkspace();
  return (
    <UsersScreen
      currentUserId={session.userId}
      abilities={{
        canView: hasSessionPermission(session, CORE_PERMISSIONS.usersView),
        canManageUsers: hasSessionPermission(session, CORE_PERMISSIONS.usersManage),
        canAssignRoles: hasSessionPermission(session, CORE_PERMISSIONS.rolesAssign),
      }}
    />
  );
}
