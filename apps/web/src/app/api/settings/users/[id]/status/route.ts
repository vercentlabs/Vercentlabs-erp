import { z } from "zod";

import { audit, setMemberStatus } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const putSchema = z.object({ status: z.enum(["active", "disabled"]) });

// setMemberStatus enforces target scope, self-target prohibition, seat
// limits and session revocation, and writes access evidence.
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersManage, action: "settings.user_status.update", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const body = putSchema.parse(await readJson(request));
      const result = await setMemberStatus(client, session, id, body.status);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "user.membership_status_changed",
        entityType: "organization_membership",
        entityId: id,
        afterData: { status: body.status },
        request,
        env: process.env,
      });
      return ok(result);
    },
  );
}
