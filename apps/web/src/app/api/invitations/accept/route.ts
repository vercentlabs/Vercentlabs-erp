import { randomUUID } from "node:crypto";

import {
  createSession,
  hashPassword,
  setSessionCookie,
  tokenHash,
  verifyPassword,
} from "@/lib/auth";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { passwordPolicyIssues } from "@/lib/password-policy";
import { assertSameOrigin, audit } from "@/lib/security";
import { acceptInvitationSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = acceptInvitationSchema.parse(await readJson(request));

    const accepted = await transaction(async (client) => {
      const invitationResult = await client.query<{
        id: string;
        organization_id: string;
        email: string;
        role_id: string;
        role_slug: string;
        role_name: string;
      }>(
        `
        SELECT i.id, i.organization_id, i.email, i.role_id,
          r.slug AS role_slug, r.name AS role_name
        FROM organization_invitations i
        JOIN roles r ON r.id = i.role_id AND r.organization_id = i.organization_id
        WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
        FOR UPDATE
      `,
        [tokenHash(input.token)],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation)
        throw new HttpError(400, "This invitation is invalid or expired.");

      const userResult = await client.query<{
        id: string;
        password_hash: string;
      }>("SELECT id, password_hash FROM users WHERE email = $1", [
        invitation.email,
      ]);
      let userId: string;
      if (userResult.rows[0]) {
        const existing = userResult.rows[0];
        if (!(await verifyPassword(input.password, existing.password_hash))) {
          throw new HttpError(
            401,
            "This email already has an account. Enter the existing account password.",
          );
        }
        userId = existing.id;
        await client.query(
          "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), full_name = $1, status = 'active', updated_at = now() WHERE id = $2",
          [input.fullName, userId],
        );
      } else {
        const issues = passwordPolicyIssues(input.password);
        if (issues.length) throw new HttpError(400, issues[0]);
        if (input.password !== input.confirmPassword)
          throw new HttpError(400, "Passwords do not match.");
        userId = randomUUID();
        const passwordHash = await hashPassword(input.password);
        await client.query(
          `INSERT INTO users (id, email, full_name, password_hash, email_verified_at, password_changed_at) VALUES ($1,$2,$3,$4,now(),now())`,
          [userId, invitation.email, input.fullName, passwordHash],
        );
        await client.query(
          "INSERT INTO password_history (id, user_id, password_hash) VALUES ($1,$2,$3)",
          [randomUUID(), userId, passwordHash],
        );
      }

      const legacyRole = [
        "system_administrator",
        "company_administrator",
      ].includes(invitation.role_slug)
        ? "admin"
        : "member";
      await client.query(
        `
        INSERT INTO organization_memberships (organization_id, user_id, role, status)
        VALUES ($1,$2,$3,'active')
        ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'
      `,
        [invitation.organization_id, userId, legacyRole],
      );
      await client.query(
        "DELETE FROM user_role_assignments WHERE organization_id = $1 AND user_id = $2",
        [invitation.organization_id, userId],
      );
      await client.query(
        "INSERT INTO user_role_assignments (organization_id, user_id, role_id, assigned_by) SELECT organization_id, $2, role_id, invited_by FROM organization_invitations WHERE id = $1",
        [invitation.id, userId],
      );
      await client.query(
        `INSERT INTO membership_company_access (organization_id, user_id, company_id) SELECT $1,$2,id FROM companies WHERE organization_id=$1 AND status='active' ON CONFLICT DO NOTHING`,
        [invitation.organization_id, userId],
      );
      await client.query(
        `INSERT INTO membership_branch_access (organization_id, user_id, branch_id) SELECT $1,$2,id FROM branches WHERE organization_id=$1 AND status='active' ON CONFLICT DO NOTHING`,
        [invitation.organization_id, userId],
      );
      await client.query(
        `INSERT INTO membership_department_access (organization_id, user_id, department_id) SELECT $1,$2,id FROM departments WHERE organization_id=$1 AND status='active' ON CONFLICT DO NOTHING`,
        [invitation.organization_id, userId],
      );
      await client.query(
        `
        INSERT INTO user_preferences (organization_id, user_id, active_company_id, active_branch_id)
        SELECT $1,$2,c.id,b.id FROM companies c
        LEFT JOIN branches b ON b.organization_id=$1 AND b.is_primary=true
        WHERE c.organization_id=$1 AND c.is_primary=true LIMIT 1
        ON CONFLICT (organization_id, user_id) DO NOTHING
      `,
        [invitation.organization_id, userId],
      );
      await client.query(
        "UPDATE organization_invitations SET accepted_at = now() WHERE id = $1",
        [invitation.id],
      );
      await client.query(
        `INSERT INTO notifications (organization_id,user_id,type,title,message,href) VALUES ($1,$2,'access','Workspace access granted',$3,'/dashboard')`,
        [
          invitation.organization_id,
          userId,
          `You joined the organisation as ${invitation.role_name}.`,
        ],
      );
      return {
        userId,
        organizationId: invitation.organization_id,
        invitationId: invitation.id,
      };
    });

    const session = await createSession(accepted.userId, request);
    await audit({
      organizationId: accepted.organizationId,
      actorUserId: accepted.userId,
      eventType: "access.invitation_accepted",
      entityType: "invitation",
      entityId: accepted.invitationId,
      request,
    });
    const response = ok({
      message: "Invitation accepted.",
      next: "/dashboard",
    });
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
