import { audit, revokeOrganizationInvitation } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Delegated administrators may revoke only invitations inside their scope
// (asserted in revokeOrganizationInvitation).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersManage, action: "settings.invitations.revoke", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const result = await revokeOrganizationInvitation(client, {
        organizationId: session.organizationId,
        invitationId: id,
        actor: { userId: session.userId, roleSlugs: session.roleSlugs },
      });
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.invitation.revoked",
        entityType: "organization_invitation",
        entityId: id,
        request,
        env: process.env,
      });
      return ok(result);
    },
  );
}
