import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { randomUUID } from "node:crypto";

import { createOpaqueToken, getSessionContext, tokenHash } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { deliverAuthMessage } from "@/lib/mailer";
import { assertSameOrigin, audit } from "@/lib/security";
import { invitationSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.usersManage);
    await requireBillingWriteAccess(session.organizationId);
    const input = invitationSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");

    const roleRows = await query<{ id: string; slug: string; name: string }>(
      "SELECT id, slug, name FROM roles WHERE id = $1 AND organization_id = $2 AND status = 'active'",
      [input.roleId, session.organizationId],
    );
    const role = roleRows[0];
    if (!role) throw new HttpError(400, "Select a valid organisation role.");
    if (role.slug === "organization_owner")
      throw new HttpError(
        400,
        "Organisation ownership must be transferred from user administration.",
      );

    const existingMember = await query<{ id: string }>(
      `
      SELECT u.id FROM users u
      JOIN organization_memberships m ON m.user_id = u.id
      WHERE m.organization_id = $1 AND u.email = $2
    `,
      [session.organizationId, input.email],
    );
    if (existingMember[0])
      throw new HttpError(
        409,
        "This user already belongs to the organisation.",
      );

    if (
      process.env.NODE_ENV === "production" &&
      !(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASSWORD &&
        process.env.AUTH_EMAIL_FROM
      ) &&
      !process.env.AUTH_EMAIL_WEBHOOK_URL
    ) {
      throw new HttpError(503, "Invitation email delivery is not configured.");
    }

    const rawToken = createOpaqueToken();
    const invitationId = randomUUID();
    await transaction(async (client) => {
      await client.query(
        `
        UPDATE organization_invitations
        SET revoked_at = now()
        WHERE organization_id = $1 AND email = $2
          AND accepted_at IS NULL AND revoked_at IS NULL
      `,
        [session.organizationId, input.email],
      );
      await client.query(
        `
        INSERT INTO organization_invitations (
          id, organization_id, email, role, role_id, token_hash,
          invited_by, expires_at, last_sent_at, send_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,now() + interval '7 days',now(),1)
      `,
        [
          invitationId,
          session.organizationId,
          input.email,
          role.slug,
          role.id,
          tokenHash(rawToken),
          session.userId,
        ],
      );
    });

    const url =
      (process.env.APP_URL || "http://localhost:3001") +
      "/invite?token=" +
      encodeURIComponent(rawToken);
    await deliverAuthMessage({
      type: "organization-invitation",
      email: input.email,
      url,
      organizationName: session.organizationName || undefined,
    });
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "access.invitation_created",
      entityType: "invitation",
      entityId: invitationId,
      metadata: { email: input.email, role: role.slug },
      request,
    });

    return ok(
      {
        message: "Invitation created.",
        ...(process.env.NODE_ENV !== "production"
          ? { developmentUrl: url }
          : {}),
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
