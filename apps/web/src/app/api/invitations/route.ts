import { randomUUID } from "node:crypto";

import {
  validateRoleSelection,
  validateScopeGrantCeiling,
} from "@/core/access-admin";
import { createOpaqueToken, getSessionContext, tokenHash } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { query, transaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { deliverAuthMessage } from "@/core/mailer";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { invitationSchema } from "@/core/validation";

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const organizationId = session.organizationId;
    requirePermissionFromSession(session, PERMISSIONS.usersManage);
    requirePermissionFromSession(session, PERMISSIONS.rolesAssign);
    await requireBillingWriteAccess(organizationId);
    const input = invitationSchema.parse(await readJson(request));

    const existingMember = await query<{ id: string }>(
      `SELECT app_user.id FROM users app_user
       JOIN organization_memberships membership ON membership.user_id=app_user.id
       WHERE membership.organization_id=$1 AND app_user.email=$2`,
      [organizationId, input.email],
    );
    if (existingMember[0]) {
      throw new HttpError(
        409,
        "This user already belongs to the organisation.",
      );
    }
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
    const selected = await transaction(async (client) => {
      const roleSelection = await validateRoleSelection(client, {
        organizationId,
        roleIds: input.roleIds,
        primaryRoleId: input.primaryRoleId,
        actor: session,
        acknowledgeWarningConflicts: input.acknowledgeWarningConflicts,
        allowOwnerRole: false,
      });

      let companyIds = [...new Set(input.companyIds)];
      if (!companyIds.length) {
        const defaults = await client.query<{ id: string }>(
          `SELECT company.id FROM companies company
           WHERE company.organization_id=$1 AND company.status='active'
             AND ($3::boolean OR EXISTS (
               SELECT 1 FROM membership_company_access access
               WHERE access.organization_id=$1 AND access.user_id=$2
                 AND access.company_id=company.id
             ))
           ORDER BY company.is_primary DESC,company.created_at,company.id LIMIT 1`,
          [
            organizationId,
            session.userId,
            session.roleSlugs.includes("organization_owner") ||
              session.roleSlugs.includes("system_administrator"),
          ],
        );
        companyIds = defaults.rows.map((row) => row.id);
      }
      if (!companyIds.length) {
        throw new HttpError(
          409,
          "Create an active company before inviting users.",
        );
      }
      let branchIds = [...new Set(input.branchIds)];
      if (!branchIds.length) {
        const defaults = await client.query<{ id: string }>(
          `SELECT id FROM branches WHERE organization_id=$1
             AND company_id=ANY($2::uuid[]) AND status='active'
           ORDER BY is_primary DESC,created_at,id LIMIT 1`,
          [organizationId, companyIds],
        );
        branchIds = defaults.rows.map((row) => row.id);
      }
      const departmentIds = [...new Set(input.departmentIds)];
      const teamIds = [...new Set(input.teamIds)];
      const [companies, branches, departments, teams] = await Promise.all([
        client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM companies
           WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])`,
          [organizationId, companyIds],
        ),
        client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM branches
           WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])
             AND company_id=ANY($3::uuid[])`,
          [organizationId, branchIds, companyIds],
        ),
        client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM departments
           WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])
             AND (company_id IS NULL OR company_id=ANY($3::uuid[]))
             AND (branch_id IS NULL OR cardinality($4::uuid[])=0 OR branch_id=ANY($4::uuid[]))`,
          [organizationId, departmentIds, companyIds, branchIds],
        ),
        client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM teams team
           WHERE team.organization_id=$1 AND team.status='active' AND team.id=ANY($2::uuid[])
             AND (team.department_id IS NULL OR team.department_id=ANY($3::uuid[]))`,
          [organizationId, teamIds, departmentIds],
        ),
      ]);
      if (
        companies.rows[0]?.count !== companyIds.length ||
        branches.rows[0]?.count !== branchIds.length ||
        departments.rows[0]?.count !== departmentIds.length ||
        teams.rows[0]?.count !== teamIds.length
      ) {
        throw new HttpError(
          400,
          "One or more invitation access scopes are invalid.",
        );
      }
      await validateScopeGrantCeiling(client, {
        organizationId,
        actorUserId: session.userId,
        actorRoleSlugs: session.roleSlugs,
        companyIds,
        branchIds,
        departmentIds,
        teamIds,
      });

      await client.query(
        `UPDATE organization_invitations SET revoked_at=now()
         WHERE organization_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [organizationId, input.email],
      );
      await client.query(
        `INSERT INTO organization_invitations(
           id,organization_id,email,role,role_id,token_hash,invited_by,
           expires_at,last_sent_at,send_count
         ) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days',now(),1)`,
        [
          invitationId,
          organizationId,
          input.email,
          roleSelection.primaryRole.slug,
          roleSelection.primaryRole.id,
          tokenHash(rawToken),
          session.userId,
        ],
      );
      const accessStartsAt = input.accessStartsAt || new Date().toISOString();
      for (const role of roleSelection.roles) {
        await client.query(
          `INSERT INTO organization_invitation_roles(
             invitation_id,organization_id,role_id,is_primary,starts_at,expires_at
           ) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            invitationId,
            organizationId,
            role.id,
            role.id === input.primaryRoleId,
            accessStartsAt,
            input.accessExpiresAt || null,
          ],
        );
      }
      for (const companyId of companyIds) {
        await client.query(
          `INSERT INTO organization_invitation_company_access(invitation_id,organization_id,company_id)
           VALUES($1,$2,$3)`,
          [invitationId, organizationId, companyId],
        );
      }
      for (const branchId of branchIds) {
        await client.query(
          `INSERT INTO organization_invitation_branch_access(invitation_id,organization_id,branch_id)
           VALUES($1,$2,$3)`,
          [invitationId, organizationId, branchId],
        );
      }
      for (const departmentId of departmentIds) {
        await client.query(
          `INSERT INTO organization_invitation_department_access(invitation_id,organization_id,department_id)
           VALUES($1,$2,$3)`,
          [invitationId, organizationId, departmentId],
        );
      }
      for (const teamId of teamIds) {
        await client.query(
          `INSERT INTO organization_invitation_team_access(invitation_id,organization_id,team_id)
           VALUES($1,$2,$3)`,
          [invitationId, organizationId, teamId],
        );
      }
      return {
        roleNames: roleSelection.roles.map((role) => role.name),
        companyIds,
        branchIds,
        departmentIds,
        teamIds,
      };
    });

    await incrementBillingUsage(organizationId, "api_requests_monthly");
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
      organizationId,
      actorUserId: session.userId,
      eventType: "access.invitation_created",
      entityType: "invitation",
      entityId: invitationId,
      metadata: {
        email: input.email,
        roles: selected.roleNames,
        scopeCounts: {
          companies: selected.companyIds.length,
          branches: selected.branchIds.length,
          departments: selected.departmentIds.length,
          teams: selected.teamIds.length,
        },
      },
      request,
    });
    return ok(
      {
        message: `Invitation created with ${selected.roleNames.join(" + ")}.`,
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
