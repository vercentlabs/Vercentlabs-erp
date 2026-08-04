import { randomUUID } from "node:crypto";

import { validateInvitationRolesForAcceptance } from "@/lib/access-administration";

import {
  createSession,
  hashPassword,
  setSessionCookie,
  tokenHash,
  verifyPasswordOrDummy,
} from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { passwordPolicyIssues } from "@/lib/password-policy";
import {
  assertSameOrigin,
  audit,
  clientIp,
  enforceRateLimit,
  sha256,
} from "@/lib/security";
import { acceptInvitationSchema } from "@/lib/validation";

const invalidInvitation = "This invitation is invalid or expired.";
const invalidCredentials = "The invitation could not be accepted.";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = acceptInvitationSchema.parse(await readJson(request));
    const invitationTokenHash = tokenHash(input.token);

    await enforceRateLimit(`invite-accept-ip:${clientIp(request)}`, 12, 900);
    await enforceRateLimit(
      `invite-accept-token:${invitationTokenHash}`,
      8,
      900,
    );

    const invitationRows = await query<{
      id: string;
      organization_id: string;
      email: string;
      role_id: string;
      role_slug: string;
      role_name: string;
      user_id: string | null;
      password_hash: string | null;
      user_status: string | null;
    }>(
      `
        SELECT
          invitation.id,
          invitation.organization_id,
          invitation.email,
          invitation.role_id,
          role.slug AS role_slug,
          role.name AS role_name,
          app_user.id AS user_id,
          app_user.password_hash,
          app_user.status AS user_status
        FROM organization_invitations AS invitation
        JOIN roles AS role
          ON role.id = invitation.role_id
         AND role.organization_id = invitation.organization_id
         AND role.status = 'active'
        LEFT JOIN users AS app_user ON app_user.email = invitation.email
        WHERE invitation.token_hash = $1
          AND invitation.accepted_at IS NULL
          AND invitation.revoked_at IS NULL
          AND invitation.expires_at > now()
        LIMIT 1
      `,
      [invitationTokenHash],
    );
    const invitationSnapshot = invitationRows[0];
    if (!invitationSnapshot) throw new HttpError(400, invalidInvitation);

    await enforceRateLimit(
      `invite-accept-email:${sha256(invitationSnapshot.email)}`,
      8,
      900,
    );

    const existingPasswordValid = await verifyPasswordOrDummy(
      input.password,
      invitationSnapshot.password_hash,
    );
    if (invitationSnapshot.user_id) {
      if (
        !existingPasswordValid ||
        invitationSnapshot.user_status !== "active"
      ) {
        throw new HttpError(401, invalidCredentials);
      }
    } else {
      if (input.fullName.length < 2) {
        throw new HttpError(400, "Enter your full name.");
      }
      const issues = passwordPolicyIssues(input.password);
      if (issues.length) throw new HttpError(400, issues[0]);
      if (input.password !== input.confirmPassword)
        throw new HttpError(400, "Passwords do not match.");
    }

    const newPasswordHash = invitationSnapshot.user_id
      ? null
      : await hashPassword(input.password);

    const accepted = await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [invitationSnapshot.email],
      );

      const invitationResult = await client.query<{
        id: string;
        organization_id: string;
        email: string;
        role_id: string;
        role_slug: string;
        role_name: string;
      }>(
        `
        SELECT invitation.id,
          invitation.organization_id,
          invitation.email,
          invitation.role_id,
          role.slug AS role_slug,
          role.name AS role_name
        FROM organization_invitations AS invitation
        JOIN roles AS role
          ON role.id = invitation.role_id
         AND role.organization_id = invitation.organization_id
         AND role.status = 'active'
        WHERE invitation.token_hash = $1
          AND invitation.accepted_at IS NULL
          AND invitation.revoked_at IS NULL
          AND invitation.expires_at > now()
        FOR UPDATE OF invitation
      `,
        [invitationTokenHash],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation || invitation.id !== invitationSnapshot.id) {
        throw new HttpError(400, invalidInvitation);
      }
      await validateInvitationRolesForAcceptance(client, {
        organizationId: invitation.organization_id,
        invitationId: invitation.id,
      });

      const currentUserResult = await client.query<{
        id: string;
        password_hash: string;
        status: string;
      }>(
        "SELECT id, password_hash, status FROM users WHERE email = $1 FOR UPDATE",
        [invitation.email],
      );

      let userId: string;
      const currentUser = currentUserResult.rows[0];
      if (currentUser) {
        if (
          currentUser.id !== invitationSnapshot.user_id ||
          currentUser.status !== "active"
        ) {
          throw new HttpError(409, invalidCredentials);
        }
        userId = currentUser.id;
        await client.query(
          `
            UPDATE users
            SET email_verified_at = COALESCE(email_verified_at, now()),
                updated_at = now()
            WHERE id = $1 AND status = 'active'
          `,
          [userId],
        );
      } else {
        if (!newPasswordHash || invitationSnapshot.user_id) {
          throw new HttpError(409, invalidCredentials);
        }
        userId = randomUUID();
        await client.query(
          `
            INSERT INTO users (
              id, email, full_name, password_hash,
              email_verified_at, password_changed_at
            ) VALUES ($1, $2, $3, $4, now(), now())
          `,
          [userId, invitation.email, input.fullName, newPasswordHash],
        );
        await client.query(
          `
            INSERT INTO password_history (id, user_id, password_hash)
            VALUES ($1, $2, $3)
          `,
          [randomUUID(), userId, newPasswordHash],
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
        INSERT INTO organization_memberships (
          organization_id, user_id, role, status
        ) VALUES ($1, $2, $3, 'active')
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          role = EXCLUDED.role,
          status = 'active'
      `,
        [invitation.organization_id, userId, legacyRole],
      );
      await client.query(
        `UPDATE user_role_assignments
            SET status='revoked',is_primary=false,revoked_at=now(),updated_at=now(),
                reason='Replaced by accepted invitation'
          WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
        [invitation.organization_id, userId],
      );
      const assignedRoleIds = await client.query<{ role_id: string }>(
        `INSERT INTO user_role_assignments(
           organization_id,user_id,role_id,assigned_by,is_primary,starts_at,
           expires_at,status,reason
         )
         SELECT invitation_role.organization_id,$2,invitation_role.role_id,
                invitation.invited_by,invitation_role.is_primary,
                invitation_role.starts_at,invitation_role.expires_at,'active',
                'Accepted organisation invitation'
         FROM organization_invitation_roles invitation_role
         JOIN organization_invitations invitation ON invitation.id=invitation_role.invitation_id
         WHERE invitation_role.invitation_id=$1
         ON CONFLICT(organization_id,user_id,role_id) DO UPDATE SET
           assigned_by=EXCLUDED.assigned_by,is_primary=EXCLUDED.is_primary,
           starts_at=EXCLUDED.starts_at,expires_at=EXCLUDED.expires_at,
           status='active',reason=EXCLUDED.reason,revoked_at=NULL,revoked_by=NULL,
           updated_at=now()
         RETURNING role_id`,
        [invitation.id, userId],
      );
      if (!assignedRoleIds.rowCount)
        throw new HttpError(409, invalidInvitation);
      const assignedRoles = await client.query<{ role_name: string }>(
        `SELECT name AS role_name FROM roles WHERE id=ANY($1::uuid[]) ORDER BY name`,
        [assignedRoleIds.rows.map((row) => row.role_id)],
      );

      await client.query(
        `
          DELETE FROM membership_company_access
          WHERE organization_id = $1 AND user_id = $2
        `,
        [invitation.organization_id, userId],
      );
      await client.query(
        `
          DELETE FROM membership_branch_access
          WHERE organization_id = $1 AND user_id = $2
        `,
        [invitation.organization_id, userId],
      );
      await client.query(
        `
          DELETE FROM membership_department_access
          WHERE organization_id = $1 AND user_id = $2
        `,
        [invitation.organization_id, userId],
      );
      await client.query(
        `DELETE FROM membership_team_access
          WHERE organization_id=$1 AND user_id=$2`,
        [invitation.organization_id, userId],
      );

      const companyInsert = await client.query<{ company_id: string }>(
        `
          INSERT INTO membership_company_access (
            organization_id, user_id, company_id
          )
          SELECT scope.organization_id, $2, scope.company_id
          FROM organization_invitation_company_access AS scope
          JOIN companies AS company
            ON company.organization_id = scope.organization_id
           AND company.id = scope.company_id
           AND company.status = 'active'
          WHERE scope.invitation_id = $1
          ON CONFLICT DO NOTHING
          RETURNING company_id
        `,
        [invitation.id, userId],
      );

      if (!companyInsert.rowCount) {
        await client.query(
          `
            INSERT INTO membership_company_access (
              organization_id, user_id, company_id
            )
            SELECT $1, $2, company.id
            FROM companies AS company
            WHERE company.organization_id = $1
              AND company.status = 'active'
            ORDER BY company.is_primary DESC, company.created_at ASC, company.id ASC
            LIMIT 1
            ON CONFLICT DO NOTHING
          `,
          [invitation.organization_id, userId],
        );
      }

      await client.query(
        `
          INSERT INTO membership_branch_access (
            organization_id, user_id, branch_id
          )
          SELECT scope.organization_id, $2, scope.branch_id
          FROM organization_invitation_branch_access AS scope
          JOIN branches AS branch
            ON branch.organization_id = scope.organization_id
           AND branch.id = scope.branch_id
           AND branch.status = 'active'
          JOIN membership_company_access AS company_access
            ON company_access.organization_id = branch.organization_id
           AND company_access.user_id = $2
           AND company_access.company_id = branch.company_id
          WHERE scope.invitation_id = $1
          ON CONFLICT DO NOTHING
        `,
        [invitation.id, userId],
      );
      await client.query(
        `
          INSERT INTO membership_branch_access (
            organization_id, user_id, branch_id
          )
          SELECT branch.organization_id, $2, branch.id
          FROM branches AS branch
          JOIN membership_company_access AS company_access
            ON company_access.organization_id = branch.organization_id
           AND company_access.user_id = $2
           AND company_access.company_id = branch.company_id
          WHERE branch.organization_id = $1
            AND branch.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM membership_branch_access AS existing
              WHERE existing.organization_id = $1 AND existing.user_id = $2
            )
          ORDER BY branch.is_primary DESC, branch.created_at ASC, branch.id ASC
          LIMIT 1
          ON CONFLICT DO NOTHING
        `,
        [invitation.organization_id, userId],
      );
      await client.query(
        `
          INSERT INTO membership_department_access (
            organization_id, user_id, department_id
          )
          SELECT scope.organization_id, $2, scope.department_id
          FROM organization_invitation_department_access AS scope
          JOIN departments AS department
            ON department.organization_id = scope.organization_id
           AND department.id = scope.department_id
           AND department.status = 'active'
          WHERE scope.invitation_id = $1
          ON CONFLICT DO NOTHING
        `,
        [invitation.id, userId],
      );
      await client.query(
        `INSERT INTO membership_team_access(organization_id,user_id,team_id)
         SELECT scope.organization_id,$2,scope.team_id
         FROM organization_invitation_team_access scope
         JOIN teams team ON team.organization_id=scope.organization_id
           AND team.id=scope.team_id AND team.status='active'
         WHERE scope.invitation_id=$1
         ON CONFLICT DO NOTHING`,
        [invitation.id, userId],
      );

      await client.query(
        `
        INSERT INTO user_preferences (
          organization_id, user_id, active_company_id, active_branch_id
        )
        SELECT
          $1,
          $2,
          company_access.company_id,
          branch_access.branch_id
        FROM membership_company_access AS company_access
        LEFT JOIN LATERAL (
          SELECT access.branch_id
          FROM membership_branch_access AS access
          JOIN branches AS branch
            ON branch.organization_id = access.organization_id
           AND branch.id = access.branch_id
           AND branch.company_id = company_access.company_id
          WHERE access.organization_id = company_access.organization_id
            AND access.user_id = company_access.user_id
          ORDER BY branch.is_primary DESC, branch.created_at ASC, branch.id ASC
          LIMIT 1
        ) AS branch_access ON true
        WHERE company_access.organization_id = $1
          AND company_access.user_id = $2
        ORDER BY company_access.created_at ASC, company_access.company_id ASC
        LIMIT 1
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          active_company_id = EXCLUDED.active_company_id,
          active_branch_id = EXCLUDED.active_branch_id,
          updated_at = now()
      `,
        [invitation.organization_id, userId],
      );

      const consumed = await client.query(
        `
          UPDATE organization_invitations
          SET accepted_at = now()
          WHERE id = $1
            AND accepted_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > now()
        `,
        [invitation.id],
      );
      if (consumed.rowCount !== 1) throw new HttpError(409, invalidInvitation);

      await client.query(
        `
          INSERT INTO notifications (
            organization_id, user_id, type, title, message, href
          ) VALUES ($1, $2, 'access', 'Workspace access granted', $3, '/profile')
        `,
        [
          invitation.organization_id,
          userId,
          `You joined the organisation with ${assignedRoles.rows.map((row) => row.role_name).join(" + ")}.`,
        ],
      );

      await client.query(
        `INSERT INTO access_assignment_events(
           organization_id,user_id,actor_user_id,event_type,before_state,after_state
         ) VALUES($1,$2,NULL,'invitation_accepted',NULL,$3::jsonb)`,
        [
          invitation.organization_id,
          userId,
          JSON.stringify({
            roleNames: assignedRoles.rows.map((row) => row.role_name),
            invitationId: invitation.id,
          }),
        ],
      );

      return {
        userId,
        organizationId: invitation.organization_id,
        invitationId: invitation.id,
      };
    });

    const session = await createSession(
      accepted.userId,
      request,
      accepted.organizationId,
    );
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
    response.headers.set("Cache-Control", "private, no-store");
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
