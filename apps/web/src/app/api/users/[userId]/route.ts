import { getSessionContext } from "@/core/auth";
import {
  assertUserWithinAdministrationScope,
  getUserAccessState,
  validateRoleSelection,
  validateScopeGrantCeiling,
} from "@/core/access-admin";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { transaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { userAccessSchema } from "@/core/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const organizationId = session.organizationId;
    requirePermissionFromSession(session, PERMISSIONS.usersManage);
    requirePermissionFromSession(session, PERMISSIONS.rolesAssign);
    const { userId } = await context.params;
    const input = userAccessSchema.parse(await readJson(request));
    if (userId === session.userId) {
      throw new HttpError(
        400,
        "Use another administrator to change your own roles or access scope.",
      );
    }

    const result = await transaction(async (client) => {
      const targetResult = await client.query<{
        full_name: string;
        membership_status: string;
        is_owner: boolean;
      }>(
        `SELECT u.full_name,m.status AS membership_status,
          EXISTS(
            SELECT 1 FROM user_role_assignments ura JOIN roles r ON r.id=ura.role_id
            WHERE ura.organization_id=m.organization_id AND ura.user_id=m.user_id
              AND ura.status='active' AND r.slug='organization_owner'
          ) AS is_owner
         FROM organization_memberships m JOIN users u ON u.id=m.user_id
         WHERE m.organization_id=$1 AND m.user_id=$2
         FOR UPDATE OF m`,
        [organizationId, userId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new HttpError(404, "User access was not found.");
      await assertUserWithinAdministrationScope(client, {
        organizationId,
        actorUserId: session.userId,
        actorRoleSlugs: session.roleSlugs,
        targetUserId: userId,
      });
      if (target.is_owner) {
        throw new HttpError(
          400,
          "The organisation owner cannot be edited directly. Transfer ownership to another user instead.",
        );
      }

      const selection = await validateRoleSelection(client, {
        organizationId,
        roleIds: input.roleIds,
        primaryRoleId: input.primaryRoleId,
        actor: session,
        acknowledgeWarningConflicts: input.acknowledgeWarningConflicts,
        allowOwnerRole: session.roleSlugs.includes("organization_owner"),
      });
      const transferringOwnership =
        selection.primaryRole.slug === "organization_owner";
      if (transferringOwnership) {
        if (!session.roleSlugs.includes("organization_owner")) {
          throw new HttpError(
            403,
            "Only the organisation owner can transfer ownership.",
          );
        }
        if (input.status !== "active" || input.accessExpiresAt) {
          throw new HttpError(
            400,
            "Organisation ownership must be active and cannot expire.",
          );
        }
        if (selection.roles.length !== 1) {
          throw new HttpError(
            400,
            "Organisation Owner must be the only selected role during transfer.",
          );
        }
      }

      if (
        !selection.roles.some((role) =>
          ["organization_owner", "system_administrator"].includes(role.slug),
        ) &&
        input.companyIds.length === 0
      ) {
        throw new HttpError(
          400,
          "Select at least one company for a business user.",
        );
      }

      const [companyCount, branchCount, departmentCount, teamCount] =
        await Promise.all([
          client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM companies
             WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])`,
            [organizationId, input.companyIds],
          ),
          client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM branches
             WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])
               AND company_id=ANY($3::uuid[])`,
            [organizationId, input.branchIds, input.companyIds],
          ),
          client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM departments
             WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])
               AND (company_id IS NULL OR company_id=ANY($3::uuid[]))
               AND (branch_id IS NULL OR cardinality($4::uuid[])=0 OR branch_id=ANY($4::uuid[]))`,
            [
              organizationId,
              input.departmentIds,
              input.companyIds,
              input.branchIds,
            ],
          ),
          client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM teams team
             WHERE team.organization_id=$1 AND team.status='active' AND team.id=ANY($2::uuid[])
               AND (team.department_id IS NULL OR team.department_id=ANY($3::uuid[]))`,
            [organizationId, input.teamIds, input.departmentIds],
          ),
        ]);
      if (
        companyCount.rows[0]?.count !== input.companyIds.length ||
        branchCount.rows[0]?.count !== input.branchIds.length ||
        departmentCount.rows[0]?.count !== input.departmentIds.length ||
        teamCount.rows[0]?.count !== input.teamIds.length
      ) {
        throw new HttpError(
          400,
          "One or more company, branch, department or team scopes are invalid.",
        );
      }
      await validateScopeGrantCeiling(client, {
        organizationId,
        actorUserId: session.userId,
        actorRoleSlugs: session.roleSlugs,
        companyIds: input.companyIds,
        branchIds: input.branchIds,
        departmentIds: input.departmentIds,
        teamIds: input.teamIds,
      });

      const beforeState = await getUserAccessState(
        client,
        organizationId,
        userId,
      );

      if (transferringOwnership) {
        const adminRole = await client.query<{ id: string }>(
          `SELECT id FROM roles WHERE organization_id=$1
            AND slug='system_administrator' AND status='active'`,
          [organizationId],
        );
        if (!adminRole.rows[0]) {
          throw new HttpError(500, "System Administrator role is missing.");
        }
        await client.query(
          `UPDATE user_role_assignments SET is_primary=false,updated_at=now()
            WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
          [organizationId, session.userId],
        );
        await client.query(
          `UPDATE user_role_assignments ura SET status='revoked',revoked_at=now(),
             revoked_by=$3,is_primary=false,reason='Organisation ownership transferred',updated_at=now()
           FROM roles r WHERE ura.role_id=r.id AND ura.organization_id=$1
             AND ura.user_id=$2 AND r.slug='organization_owner' AND ura.status='active'`,
          [organizationId, session.userId, session.userId],
        );
        await client.query(
          `INSERT INTO user_role_assignments(
             organization_id,user_id,role_id,assigned_by,is_primary,starts_at,status,reason
           ) VALUES($1,$2,$3,$2,true,now(),'active','Previous owner retained as System Administrator')
           ON CONFLICT(organization_id,user_id,role_id) DO UPDATE SET
             assigned_by=EXCLUDED.assigned_by,is_primary=true,starts_at=now(),expires_at=NULL,
             status='active',reason=EXCLUDED.reason,revoked_at=NULL,revoked_by=NULL,updated_at=now()`,
          [organizationId, session.userId, adminRole.rows[0].id],
        );
        await client.query(
          `UPDATE organization_memberships SET role='admin'
            WHERE organization_id=$1 AND user_id=$2`,
          [organizationId, session.userId],
        );
      }

      await client.query(
        `UPDATE user_role_assignments SET is_primary=false,updated_at=now()
          WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
        [organizationId, userId],
      );
      await client.query(
        `UPDATE user_role_assignments SET status='revoked',revoked_at=now(),revoked_by=$3,
           is_primary=false,reason=$4,updated_at=now()
         WHERE organization_id=$1 AND user_id=$2 AND status='active'
           AND NOT(role_id=ANY($5::uuid[]))`,
        [organizationId, userId, session.userId, input.reason, input.roleIds],
      );
      const startsAt = input.accessStartsAt || new Date().toISOString();
      for (const role of selection.roles) {
        await client.query(
          `INSERT INTO user_role_assignments(
             organization_id,user_id,role_id,assigned_by,is_primary,starts_at,
             expires_at,status,reason,updated_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,now())
           ON CONFLICT(organization_id,user_id,role_id) DO UPDATE SET
             assigned_by=EXCLUDED.assigned_by,is_primary=EXCLUDED.is_primary,
             starts_at=EXCLUDED.starts_at,expires_at=EXCLUDED.expires_at,
             status='active',reason=EXCLUDED.reason,revoked_at=NULL,revoked_by=NULL,updated_at=now()`,
          [
            organizationId,
            userId,
            role.id,
            session.userId,
            role.id === input.primaryRoleId,
            startsAt,
            input.accessExpiresAt || null,
            input.reason,
          ],
        );
      }

      const legacyRole =
        selection.primaryRole.slug === "organization_owner"
          ? "owner"
          : ["system_administrator", "company_administrator"].includes(
                selection.primaryRole.slug,
              )
            ? "admin"
            : "member";
      await client.query(
        `UPDATE organization_memberships SET role=$3,status=$4
          WHERE organization_id=$1 AND user_id=$2`,
        [organizationId, userId, legacyRole, input.status],
      );

      for (const table of [
        "membership_company_access",
        "membership_branch_access",
        "membership_department_access",
        "membership_team_access",
      ]) {
        await client.query(
          `DELETE FROM ${table} WHERE organization_id=$1 AND user_id=$2`,
          [organizationId, userId],
        );
      }
      for (const companyId of input.companyIds) {
        await client.query(
          `INSERT INTO membership_company_access(organization_id,user_id,company_id)
           VALUES($1,$2,$3)`,
          [organizationId, userId, companyId],
        );
      }
      for (const branchId of input.branchIds) {
        await client.query(
          `INSERT INTO membership_branch_access(organization_id,user_id,branch_id)
           VALUES($1,$2,$3)`,
          [organizationId, userId, branchId],
        );
      }
      for (const departmentId of input.departmentIds) {
        await client.query(
          `INSERT INTO membership_department_access(organization_id,user_id,department_id)
           VALUES($1,$2,$3)`,
          [organizationId, userId, departmentId],
        );
      }
      for (const teamId of input.teamIds) {
        await client.query(
          `INSERT INTO membership_team_access(organization_id,user_id,team_id)
           VALUES($1,$2,$3)`,
          [organizationId, userId, teamId],
        );
      }

      await client.query(
        `UPDATE user_preferences preference SET
          active_company_id=CASE WHEN preference.active_company_id=ANY($3::uuid[])
            THEN preference.active_company_id ELSE (
              SELECT company.id FROM companies company
               WHERE company.organization_id=$1 AND company.id=ANY($3::uuid[]) AND company.status='active'
               ORDER BY company.is_primary DESC,company.created_at,company.id LIMIT 1) END,
          active_branch_id=CASE WHEN preference.active_branch_id=ANY($4::uuid[])
            THEN preference.active_branch_id ELSE (
              SELECT branch.id FROM branches branch
               WHERE branch.organization_id=$1 AND branch.id=ANY($4::uuid[]) AND branch.status='active'
                 AND branch.company_id=ANY($3::uuid[])
               ORDER BY branch.is_primary DESC,branch.created_at,branch.id LIMIT 1) END,
          updated_at=now()
         WHERE preference.organization_id=$1 AND preference.user_id=$2`,
        [organizationId, userId, input.companyIds, input.branchIds],
      );
      await client.query(
        `UPDATE sessions SET revoked_at=now(),
          revoked_reason=CASE WHEN $2='disabled' THEN 'membership_disabled' ELSE 'access_changed' END
          WHERE user_id=$1 AND revoked_at IS NULL`,
        [userId, input.status],
      );
      if (transferringOwnership) {
        await client.query(
          `UPDATE sessions SET revoked_at=now(),revoked_reason='ownership_transferred'
            WHERE user_id=$1 AND revoked_at IS NULL`,
          [session.userId],
        );
      }

      const afterState = await getUserAccessState(
        client,
        organizationId,
        userId,
      );
      await client.query(
        `INSERT INTO access_assignment_events(
           organization_id,user_id,actor_user_id,event_type,before_state,after_state
         ) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [
          organizationId,
          userId,
          session.userId,
          transferringOwnership
            ? "ownership_transferred"
            : "roles_and_scope_updated",
          JSON.stringify(beforeState),
          JSON.stringify(afterState),
        ],
      );
      await client.query(
        `INSERT INTO notifications(organization_id,user_id,type,title,message,href)
         VALUES($1,$2,'access','Access settings changed',$3,'/profile')`,
        [
          organizationId,
          userId,
          `Your roles are now ${selection.roles.map((role) => role.name).join(", ")}.`,
        ],
      );
      return {
        name: target.full_name,
        transferringOwnership,
        roleNames: selection.roles.map((role) => role.name),
      };
    });

    await audit({
      organizationId,
      actorUserId: session.userId,
      eventType: result.transferringOwnership
        ? "access.ownership_transferred"
        : "access.user_updated",
      entityType: "user",
      entityId: userId,
      afterData: input,
      request,
    });
    return ok({
      message: result.transferringOwnership
        ? `Ownership transferred to ${result.name}. Your current sessions were revoked.`
        : `${result.name} now has ${result.roleNames.join(" + ")}. Active sessions were revoked.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
