import { z } from "zod";

import { createRole, listOrganizationRolesDetailed } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Role catalogue administration. Role definitions are organization-global
// (roles.manage: Owner / System Administrator); the grant ceiling, SoD and
// reserved-role protection are enforced again inside createRole.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesView, action: "settings.roles.list" },
    async ({ client, session }) => ok({ roles: await listOrganizationRolesDetailed(client, session) }),
  );
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  moduleKey: z.string().trim().min(1).max(50).optional(),
  riskLevel: z.enum(["standard", "sensitive", "privileged"]).optional(),
  permissionKeys: z.array(z.string().trim().min(1)).max(500).optional(),
  acknowledgeWarningConflicts: z.boolean().optional(),
});

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesManage, action: "settings.roles.create", auditDenial: true },
    async ({ client, session }) => {
      const body = postSchema.parse(await readJson(request));
      return ok({ role: await createRole(client, session, body) }, 201);
    },
  );
}
