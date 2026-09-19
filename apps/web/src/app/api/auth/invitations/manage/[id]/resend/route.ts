import { assertSameOriginOrMobile, audit, resendOrganizationInvitation, requireSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { transaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    requireSessionPermission(session, CORE_PERMISSIONS.usersManage);
    const { id } = await context.params;
    const result = await transaction(async (client) => {
      const resent = await resendOrganizationInvitation(client, { organizationId: session.organizationId, invitationId: id }, process.env);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.invitation.resent",
        entityType: "organization_invitation",
        entityId: id,
        request,
        env: process.env,
      });
      return resent;
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
