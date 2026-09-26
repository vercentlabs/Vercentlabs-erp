import { z } from "zod";

import { setUserRoles } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const putSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1).max(50),
  primaryRoleId: z.string().uuid(),
  acknowledgeWarningConflicts: z.boolean().optional(),
});

// setUserRoles enforces target scope, grant ceiling, SoD and the owner-role
// prohibition, and writes access evidence.
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesAssign, action: "settings.user_roles.update", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const body = putSchema.parse(await readJson(request));
      const access = await setUserRoles(client, session, {
        targetUserId: id,
        roleIds: body.roleIds,
        primaryRoleId: body.primaryRoleId,
        acknowledgeWarningConflicts: body.acknowledgeWarningConflicts,
      });
      return ok({ access });
    },
  );
}
