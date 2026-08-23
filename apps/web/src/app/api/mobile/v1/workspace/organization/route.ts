import { getShellData } from "@/core/platform";
import { query } from "@/core/db";
import { HttpError, readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import {
  publicSession,
  requireMobileSession,
} from "@/core/mobile-session";
import { audit } from "@/core/security";
import { organizationContextSchema } from "@/core/validation";

export async function PATCH(request: Request) {
  try {
    const session = await requireMobileSession(request);
    const input = organizationContextSchema.parse(await readJson(request));

    const changed = await query<{ id: string }>(
      `UPDATE sessions
          SET active_organization_id = $3,
              last_seen_at = now()
        WHERE id = $1
          AND user_id = $2
          AND session_type = 'mobile'
          AND revoked_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM organization_memberships AS membership
              JOIN organizations AS organization
                ON organization.id = membership.organization_id
               AND organization.status = 'active'
             WHERE membership.user_id = $2
               AND membership.organization_id = $3
               AND membership.status = 'active'
          )
        RETURNING id`,
      [session.sessionId, session.userId, input.organizationId],
    );

    if (!changed[0]) {
      throw new HttpError(
        403,
        "This organisation is outside your active membership scope.",
      );
    }

    const updated = await requireMobileSession(request);
    if (!updated.organizationId) {
      throw new HttpError(500, "The organisation context could not be loaded.");
    }

    await audit({
      organizationId: updated.organizationId,
      actorUserId: updated.userId,
      eventType: "workspace.mobile_organization_changed",
      entityType: "session",
      entityId: updated.sessionId,
      beforeData: { organizationId: session.organizationId },
      afterData: { organizationId: updated.organizationId },
      request,
    });

    return mobileOk(request, {
      message: "Organisation context updated.",
      session: publicSession(updated),
      shell: await getShellData(updated),
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
