import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOriginOrMobile, audit } from "@/lib/security";
import { userAccessSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.usersManage);
    const { userId } = await context.params;
    const input = userAccessSchema.parse(await readJson(request));
    if (userId === session.userId && input.status === "disabled")
      throw new HttpError(400, "You cannot disable your own account.");

    const result = await transaction(async (client) => {
      const targetResult = await client.query<{
        role_slug: string | null;
        full_name: string;
      }>(
        `
        SELECT u.full_name, r.slug AS role_slug
        FROM organization_memberships m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN user_role_assignments ura ON ura.organization_id=m.organization_id AND ura.user_id=m.user_id
        LEFT JOIN roles r ON r.id=ura.role_id
        WHERE m.organization_id=$1 AND m.user_id=$2
        LIMIT 1
        FOR UPDATE OF m
      `,
        [session.organizationId, userId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new HttpError(404, "User access was not found.");

      const roleResult = await client.query<{
        id: string;
        slug: string;
        name: string;
      }>(
        "SELECT id, slug, name FROM roles WHERE id=$1 AND organization_id=$2 AND status='active'",
        [input.roleId, session.organizationId],
      );
      const role = roleResult.rows[0];
      if (!role) throw new HttpError(400, "Select a valid role.");

      const companyCount = await client.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM companies
          WHERE organization_id=$1
            AND status='active'
            AND id = ANY($2::uuid[])
        `,
        [session.organizationId, input.companyIds],
      );
      const branchCount = await client.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM branches
          WHERE organization_id=$1
            AND status='active'
            AND id = ANY($2::uuid[])
            AND company_id = ANY($3::uuid[])
        `,
        [session.organizationId, input.branchIds, input.companyIds],
      );
      const departmentCount = await client.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM departments
          WHERE organization_id=$1
            AND status='active'
            AND id = ANY($2::uuid[])
            AND (company_id IS NULL OR company_id = ANY($3::uuid[]))
            AND (
              branch_id IS NULL
              OR cardinality($4::uuid[]) = 0
              OR branch_id = ANY($4::uuid[])
            )
        `,
        [
          session.organizationId,
          input.departmentIds,
          input.companyIds,
          input.branchIds,
        ],
      );
      if (
        (companyCount.rows[0]?.count || 0) !== input.companyIds.length ||
        (branchCount.rows[0]?.count || 0) !== input.branchIds.length ||
        (departmentCount.rows[0]?.count || 0) !== input.departmentIds.length
      )
        throw new HttpError(400, "One or more access scopes are invalid.");

      if (
        target.role_slug === "organization_owner" &&
        role.slug !== "organization_owner"
      ) {
        throw new HttpError(
          400,
          "Transfer ownership to another user before changing the owner role.",
        );
      }

      if (
        role.slug === "organization_owner" &&
        target.role_slug !== "organization_owner"
      ) {
        if (!session.roleSlugs.includes("organization_owner"))
          throw new HttpError(
            403,
            "Only the organisation owner can transfer ownership.",
          );
        const adminRole = await client.query<{ id: string }>(
          "SELECT id FROM roles WHERE organization_id=$1 AND slug='system_administrator'",
          [session.organizationId],
        );
        if (!adminRole.rows[0])
          throw new HttpError(500, "System administrator role is missing.");
        await client.query(
          "DELETE FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2",
          [session.organizationId, session.userId],
        );
        await client.query(
          "INSERT INTO user_role_assignments (organization_id,user_id,role_id,assigned_by) VALUES ($1,$2,$3,$2)",
          [session.organizationId, session.userId, adminRole.rows[0].id],
        );
        await client.query(
          "UPDATE organization_memberships SET role='admin' WHERE organization_id=$1 AND user_id=$2",
          [session.organizationId, session.userId],
        );
      }

      await client.query(
        "DELETE FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2",
        [session.organizationId, userId],
      );
      await client.query(
        "INSERT INTO user_role_assignments (organization_id,user_id,role_id,assigned_by) VALUES ($1,$2,$3,$4)",
        [session.organizationId, userId, role.id, session.userId],
      );
      const legacyRole =
        role.slug === "organization_owner"
          ? "owner"
          : ["system_administrator", "company_administrator"].includes(
                role.slug,
              )
            ? "admin"
            : "member";
      await client.query(
        "UPDATE organization_memberships SET role=$3, status=$4 WHERE organization_id=$1 AND user_id=$2",
        [session.organizationId, userId, legacyRole, input.status],
      );
      await client.query(
        "DELETE FROM membership_company_access WHERE organization_id=$1 AND user_id=$2",
        [session.organizationId, userId],
      );
      await client.query(
        "DELETE FROM membership_branch_access WHERE organization_id=$1 AND user_id=$2",
        [session.organizationId, userId],
      );
      await client.query(
        "DELETE FROM membership_department_access WHERE organization_id=$1 AND user_id=$2",
        [session.organizationId, userId],
      );
      for (const companyId of input.companyIds)
        await client.query(
          "INSERT INTO membership_company_access (organization_id,user_id,company_id) VALUES ($1,$2,$3)",
          [session.organizationId, userId, companyId],
        );
      for (const branchId of input.branchIds)
        await client.query(
          "INSERT INTO membership_branch_access (organization_id,user_id,branch_id) VALUES ($1,$2,$3)",
          [session.organizationId, userId, branchId],
        );
      for (const departmentId of input.departmentIds)
        await client.query(
          "INSERT INTO membership_department_access (organization_id,user_id,department_id) VALUES ($1,$2,$3)",
          [session.organizationId, userId, departmentId],
        );
      await client.query(
        `
          UPDATE user_preferences AS preference
          SET
            active_company_id = CASE
              WHEN preference.active_company_id = ANY($3::uuid[])
              THEN preference.active_company_id
              ELSE (
                SELECT company.id
                FROM companies AS company
                WHERE company.organization_id = $1
                  AND company.id = ANY($3::uuid[])
                  AND company.status = 'active'
                ORDER BY company.is_primary DESC, company.created_at ASC, company.id ASC
                LIMIT 1
              )
            END,
            active_branch_id = CASE
              WHEN preference.active_branch_id = ANY($4::uuid[])
              THEN preference.active_branch_id
              ELSE (
                SELECT branch.id
                FROM branches AS branch
                WHERE branch.organization_id = $1
                  AND branch.id = ANY($4::uuid[])
                  AND branch.status = 'active'
                  AND branch.company_id = ANY($3::uuid[])
                ORDER BY branch.is_primary DESC, branch.created_at ASC, branch.id ASC
                LIMIT 1
              )
            END,
            updated_at = now()
          WHERE preference.organization_id = $1
            AND preference.user_id = $2
        `,
        [session.organizationId, userId, input.companyIds, input.branchIds],
      );
      await client.query(
        `
          UPDATE sessions
          SET revoked_at=now(),
              revoked_reason = CASE
                WHEN $2 = 'disabled' THEN 'membership_disabled'
                ELSE 'access_changed'
              END
          WHERE user_id=$1 AND revoked_at IS NULL
        `,
        [userId, input.status],
      );
      await client.query(
        `INSERT INTO notifications (organization_id,user_id,type,title,message,href) VALUES ($1,$2,'access','Access settings changed',$3,'/profile')`,
        [session.organizationId, userId, `Your role is now ${role.name}.`],
      );
      return { name: target.full_name, roleSlug: role.slug };
    });

    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType:
        result.roleSlug === "organization_owner"
          ? "access.ownership_transferred"
          : "access.user_updated",
      entityType: "user",
      entityId: userId,
      afterData: input,
      request,
    });
    return ok({
      message:
        result.roleSlug === "organization_owner"
          ? `Ownership transferred to ${result.name}.`
          : "User access updated.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
