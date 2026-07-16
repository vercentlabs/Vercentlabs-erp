import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { createOpaqueToken, getSessionContext, tokenHash } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { deliverAuthMessage } from "@/lib/mailer";
import { assertSameOrigin, audit } from "@/lib/security";
import { invitationActionSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.usersManage);
    const { id } = await context.params;
    const input = invitationActionSchema.parse(await readJson(request));
    if (input.action !== "revoke") {
      await requireBillingWriteAccess(session.organizationId);
      await incrementBillingUsage(
        session.organizationId,
        "api_requests_monthly",
      );
    }
    const rows = await query<{
      email: string;
      accepted_at: Date | null;
      revoked_at: Date | null;
    }>(
      "SELECT email, accepted_at, revoked_at FROM organization_invitations WHERE id = $1 AND organization_id = $2",
      [id, session.organizationId],
    );
    const invite = rows[0];
    if (!invite) throw new HttpError(404, "Invitation not found.");
    if (invite.accepted_at)
      throw new HttpError(409, "This invitation has already been accepted.");

    if (input.action === "revoke") {
      await query(
        "UPDATE organization_invitations SET revoked_at = now() WHERE id = $1 AND organization_id = $2",
        [id, session.organizationId],
      );
      await audit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "access.invitation_revoked",
        entityType: "invitation",
        entityId: id,
        request,
      });
      return ok({ message: "Invitation revoked." });
    }

    if (invite.revoked_at)
      throw new HttpError(409, "A revoked invitation cannot be resent.");
    const rawToken = createOpaqueToken();
    await query(
      `
      UPDATE organization_invitations
      SET token_hash = $3, expires_at = now() + interval '7 days', last_sent_at = now(), send_count = send_count + 1
      WHERE id = $1 AND organization_id = $2
    `,
      [id, session.organizationId, tokenHash(rawToken)],
    );
    const url =
      (process.env.APP_URL || "http://localhost:3001") +
      "/invite?token=" +
      encodeURIComponent(rawToken);
    await deliverAuthMessage({
      type: "organization-invitation",
      email: invite.email,
      url,
      organizationName: session.organizationName || undefined,
    });
    await audit({
      organizationId: session.organizationId,
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
