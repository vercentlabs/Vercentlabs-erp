import { audit, resendOrganizationInvitation } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Delegated administrators may resend only invitations inside their scope
// (asserted in resendOrganizationInvitation).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersManage, action: "settings.invitations.resend", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const result = await resendOrganizationInvitation(
        client,
        { organizationId: session.organizationId, invitationId: id, actor: { userId: session.userId, roleSlugs: session.roleSlugs } },
        process.env,
      );
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.invitation.resent",
        entityType: "organization_invitation",
        entityId: id,
        request,
        env: process.env,
      });
      return ok(result);
    },
  );
}
