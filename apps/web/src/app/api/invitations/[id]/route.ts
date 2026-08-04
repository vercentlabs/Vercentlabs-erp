import { assertInvitationWithinAdministrationScope } from "@/lib/access-administration";
import { createOpaqueToken, getSessionContext, tokenHash } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { deliverAuthMessage } from "@/lib/mailer";
import { assertSameOriginOrMobile, audit } from "@/lib/security";
import { invitationActionSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    const organizationId = session.organizationId;
    requirePermissionFromSession(session, PERMISSIONS.usersManage);
    requirePermissionFromSession(session, PERMISSIONS.rolesAssign);
    const { id } = await context.params;
    const input = invitationActionSchema.parse(await readJson(request));

    let rawToken = "";
    if (input.action === "resend") {
      await requireBillingWriteAccess(organizationId);
      await incrementBillingUsage(organizationId, "api_requests_monthly");
      rawToken = createOpaqueToken();
    }

    const invitation = await transaction(async (client) => {
      await assertInvitationWithinAdministrationScope(client, {
        organizationId,
        actorUserId: session.userId,
        actorRoleSlugs: session.roleSlugs,
        invitationId: id,
      });
      const result = await client.query<{
        email: string;
        accepted_at: Date | null;
        revoked_at: Date | null;
      }>(
        `SELECT email,accepted_at,revoked_at
           FROM organization_invitations
          WHERE id=$1 AND organization_id=$2
          FOR UPDATE`,
        [id, organizationId],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(404, "Invitation not found.");
      if (row.accepted_at) {
        throw new HttpError(409, "This invitation has already been accepted.");
      }

      if (input.action === "revoke") {
        await client.query(
          `UPDATE organization_invitations SET revoked_at=now()
            WHERE id=$1 AND organization_id=$2`,
          [id, organizationId],
        );
        return row;
      }

      if (row.revoked_at) {
        throw new HttpError(409, "A revoked invitation cannot be resent.");
      }
      await client.query(
        `UPDATE organization_invitations
            SET token_hash=$3,expires_at=now()+interval '7 days',
                last_sent_at=now(),send_count=send_count+1
          WHERE id=$1 AND organization_id=$2`,
        [id, organizationId, tokenHash(rawToken)],
      );
      return row;
    });

    if (input.action === "revoke") {
      await audit({
        organizationId,
        actorUserId: session.userId,
        eventType: "access.invitation_revoked",
        entityType: "invitation",
        entityId: id,
        request,
      });
      return ok({ message: "Invitation revoked." });
    }

    const url =
      (process.env.APP_URL || "http://localhost:3001") +
      "/invite?token=" +
      encodeURIComponent(rawToken);
    await deliverAuthMessage({
      type: "organization-invitation",
      email: invitation.email,
      url,
      organizationName: session.organizationName || undefined,
    });
    await audit({
      organizationId,
      actorUserId: session.userId,
      eventType: "access.invitation_resent",
      entityType: "invitation",
      entityId: id,
      request,
    });
    return ok({
      message: "Invitation resent.",
      ...(process.env.NODE_ENV !== "production" ? { developmentUrl: url } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
