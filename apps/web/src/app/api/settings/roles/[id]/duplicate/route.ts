import { z } from "zod";

import { duplicateRole } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({
  name: z.string().trim().max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  acknowledgeWarningConflicts: z.boolean().optional(),
});

// A copy of any role as a new custom role (roles.manage); the grant ceiling and separation of duties apply to the copy.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.rolesManage, action: "settings.roles.duplicate", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const body = schema.parse(await readJson(request));
      return ok({ role: await duplicateRole(client, session, id, body) }, 201);
    },
  );
}
