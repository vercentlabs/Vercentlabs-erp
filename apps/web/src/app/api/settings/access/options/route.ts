import { hasSessionPermission, listGrantableRolesForActor, listGrantableScope } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// What the caller may grant, decided by the server with the same rules the
// mutations enforce: companies/branches (scope ceiling) and roles (grant
// ceiling, assignability, module enablement, owner prohibition). The Users
// and Invitations dialogs render only these choices, plus the caller's exact
// abilities so the UI never offers an action the server will refuse.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersView, action: "settings.access.options", transaction: "none" },
    async ({ client, session }) => {
      const canManageUsers = hasSessionPermission(session, CORE_PERMISSIONS.usersManage);
      const canAssignRoles = hasSessionPermission(session, CORE_PERMISSIONS.rolesAssign);
      const scope = canManageUsers ? await listGrantableScope(client, session) : null;
      const roles = canManageUsers || canAssignRoles ? await listGrantableRolesForActor(client, session) : [];
      return ok({ scope, roles, abilities: { canManageUsers, canAssignRoles } });
    },
  );
}
