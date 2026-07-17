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
      SELECT app_user.id
      FROM users AS app_user
      JOIN organization_memberships AS membership
        ON membership.user_id = app_user.id
      WHERE membership.organization_id = $1
        AND app_user.email = $2
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
    const selectedScopes = await transaction(async (client) => {
      let companyIds = [...new Set(input.companyIds)];
      if (!companyIds.length) {
        const defaults = await client.query<{ id: string }>(
          `
            SELECT id
            FROM companies
            WHERE organization_id = $1 AND status = 'active'
            ORDER BY is_primary DESC, created_at ASC, id ASC
            LIMIT 1
          `,
          [session.organizationId],
        );
        companyIds = defaults.rows.map((row) => row.id);
      }
      if (!companyIds.length)
        throw new HttpError(
          409,
          "Create an active company before inviting users.",
        );

      let branchIds = [...new Set(input.branchIds)];
      if (!branchIds.length) {
        const defaults = await client.query<{ id: string }>(
          `
            SELECT id
            FROM branches
            WHERE organization_id = $1
              AND company_id = ANY($2::uuid[])
              AND status = 'active'
            ORDER BY is_primary DESC, created_at ASC, id ASC
            LIMIT 1
          `,
          [session.organizationId, companyIds],
        );
        branchIds = defaults.rows.map((row) => row.id);
      }
      const departmentIds = [...new Set(input.departmentIds)];

      const companies = await client.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM companies
          WHERE organization_id = $1
            AND status = 'active'
            AND id = ANY($2::uuid[])
        `,
        [session.organizationId, companyIds],
      );
      const branches = await client.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM branches
          WHERE organization_id = $1
            AND status = 'active'
            AND id = ANY($2::uuid[])
            AND company_id = ANY($3::uuid[])
        `,
        [session.organizationId, branchIds, companyIds],
      );
      const departments = await client.query<{ count: number }>(
        `
          SELECT count(*)::int AS count
          FROM departments
          WHERE organization_id = $1
            AND status = 'active'
            AND id = ANY($2::uuid[])
            AND (company_id IS NULL OR company_id = ANY($3::uuid[]))
            AND (
              branch_id IS NULL
              OR cardinality($4::uuid[]) = 0
              OR branch_id = ANY($4::uuid[])
            )
        `,
        [session.organizationId, departmentIds, companyIds, branchIds],
      );

      if (
        companies.rows[0]?.count !== companyIds.length ||
        branches.rows[0]?.count !== branchIds.length ||
        departments.rows[0]?.count !== departmentIds.length
      ) {
        throw new HttpError(
          400,
          "One or more invitation access scopes are invalid.",
        );
      }

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

      for (const companyId of companyIds) {
        await client.query(
          `
            INSERT INTO organization_invitation_company_access (
              invitation_id, organization_id, company_id
            ) VALUES ($1, $2, $3)
          `,
          [invitationId, session.organizationId, companyId],
        );
      }
      for (const branchId of branchIds) {
        await client.query(
          `
            INSERT INTO organization_invitation_branch_access (
              invitation_id, organization_id, branch_id
            ) VALUES ($1, $2, $3)
          `,
          [invitationId, session.organizationId, branchId],
        );
      }
      for (const departmentId of departmentIds) {
        await client.query(
          `
            INSERT INTO organization_invitation_department_access (
              invitation_id, organization_id, department_id
            ) VALUES ($1, $2, $3)
          `,
          [invitationId, session.organizationId, departmentId],
        );
      }

      return { companyIds, branchIds, departmentIds };
    });

    await incrementBillingUsage(session.organizationId, "api_requests_monthly");

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
      metadata: {
        email: input.email,
        role: role.slug,
        scopeCounts: {
          companies: selectedScopes.companyIds.length,
          branches: selectedScopes.branchIds.length,
          departments: selectedScopes.departmentIds.length,
        },
      },
      request,
    });

    return ok(
      {
        message: "Invitation created with least-privilege access.",
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
