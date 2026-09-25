import { z } from "zod";

import { archiveRole, updateRole } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const putSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  riskLevel: z.enum(["standard", "sensitive", "privileged"]).optional(),
  permissionKeys: z.array(z.string().trim().min(1)).max(500).optional(),
  acknowledgeWarningConflicts: z.boolean().optional(),
});

// Role definitions are organization-global: roles.manage (Owner / System
// Administrator). Built-in roles stay read-only (enforced in updateRole).
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesManage, action: "settings.roles.update", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const body = putSchema.parse(await readJson(request));
      return ok({ role: await updateRole(client, session, id, body) });
    },
  );
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesManage, action: "settings.roles.archive", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      await archiveRole(client, session, id);
      return ok({ archived: true });
    },
  );
}
