import { randomUUID } from "node:crypto";

import { getSessionContext } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { seedOrganizationFoundation } from "@/lib/platform";
import { assertSameOrigin, audit } from "@/lib/security";
import { uniqueOrganizationSlug } from "@/lib/slug";
import { onboardingSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session) throw new HttpError(401, "Sign in to continue.");
    if (!session.emailVerified) {
      throw new HttpError(
        403,
        "Verify your email before creating an organisation.",
      );
    }

    // A stale tab or a retry after a lost success response should continue to
    // the workspace instead of presenting onboarding as a failed operation.
    if (session.organizationId) {
      return ok({
        message: "Your organisation workspace is already ready.",
        next: "/dashboard",
        reused: true,
      });
    }

    const input = onboardingSchema.parse(await readJson(request));
    const proposedOrganizationId = randomUUID();
    const proposedCompanyId = randomUUID();
    const proposedBranchId = randomUUID();

    const result = await transaction(async (client) => {
      // Serialise onboarding for this user. This closes the two-tab race where
      // concurrent requests could otherwise create two organisations.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [session.userId],
      );

      const existing = await client.query<{ organization_id: string }>(
        `SELECT membership.organization_id
           FROM organization_memberships AS membership
           JOIN organizations AS organization
             ON organization.id = membership.organization_id
            AND organization.status = 'active'
          WHERE membership.user_id = $1
            AND membership.status = 'active'
          ORDER BY membership.created_at, membership.organization_id
          LIMIT 1`,
        [session.userId],
      );

      const existingOrganizationId = existing.rows[0]?.organization_id;
      if (existingOrganizationId) {
        const contextUpdated = await client.query<{ id: string }>(
          `UPDATE sessions
              SET active_organization_id = $3,
                  last_seen_at = now()
            WHERE id = $1
              AND user_id = $2
              AND revoked_at IS NULL
            RETURNING id`,
          [session.sessionId, session.userId, existingOrganizationId],
        );
        if (!contextUpdated.rows[0]) {
          throw new HttpError(
            500,
            "The existing organisation context could not be activated.",
          );
        }
        return { organizationId: existingOrganizationId, created: false };
      }

      const organizationId = proposedOrganizationId;
      const companyId = proposedCompanyId;
      const branchId = proposedBranchId;
      const slug = await uniqueOrganizationSlug(client, input.organizationName);

      await client.query(
        `
        INSERT INTO organizations (
          id, name, slug, country_code, timezone, base_currency,
          fiscal_year_start_month, created_by, onboarding_completed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
      `,
        [
          organizationId,
          input.organizationName,
          slug,
          input.countryCode,
          input.timezone,
          input.baseCurrency,
          input.fiscalYearStartMonth,
          session.userId,
        ],
      );

      await client.query(
        `
        INSERT INTO companies (
          id, organization_id, name, legal_name, code, country_code,
          base_currency, is_primary, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,'active')
      `,
        [
          companyId,
          organizationId,
          input.organizationName,
          input.legalCompanyName,
          input.companyCode,
          input.countryCode,
          input.baseCurrency,
        ],
      );

      await client.query(
        `
        INSERT INTO branches (
          id, organization_id, company_id, name, code, timezone, is_primary, status
        ) VALUES ($1,$2,$3,$4,$5,$6,true,'active')
      `,
        [
          branchId,
          organizationId,
          companyId,
          input.branchName,
          input.branchCode,
          input.timezone,
        ],
      );

      await client.query(
        `
        INSERT INTO organization_memberships (organization_id, user_id, role)
        VALUES ($1,$2,'owner')
      `,
        [organizationId, session.userId],
      );

      await seedOrganizationFoundation(client, {
        organizationId,
        ownerUserId: session.userId,
        companyId,
        branchId,
        timezone: input.timezone,
      });

      const contextUpdated = await client.query<{ id: string }>(
        `UPDATE sessions
         SET active_organization_id = $3
         WHERE id = $1
           AND user_id = $2
           AND revoked_at IS NULL
         RETURNING id`,
        [session.sessionId, session.userId, organizationId],
      );
      if (!contextUpdated.rows[0]) {
        throw new HttpError(
          500,
          "The new organisation context could not be activated.",
        );
      }

      await audit({
        organizationId,
        actorUserId: session.userId,
        eventType: "organization.created",
        entityType: "organization",
        entityId: organizationId,
        metadata: { companyId, branchId },
        request,
        client,
      });

      return { organizationId, created: true };
    });

    return ok(
      {
        message: result.created
          ? "Your organisation workspace is ready."
          : "Your organisation workspace was already ready.",
        next: "/dashboard",
        reused: !result.created,
      },
      result.created ? 201 : 200,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
