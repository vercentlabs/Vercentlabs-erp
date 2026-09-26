import { z } from "zod";

import { audit, updateBranch } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const putSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.branchManage, action: "settings.branches.update", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const body = putSchema.parse(await readJson(request));
      const branch = await updateBranch(client, session, id, body);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "branch.updated",
        entityType: "branch",
        entityId: id,
        afterData: body,
        request,
        env: process.env,
      });
      return ok({ branch });
    },
  );
}
