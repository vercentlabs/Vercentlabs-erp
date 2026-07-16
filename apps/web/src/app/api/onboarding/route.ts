import { randomUUID } from "node:crypto";

import { getSessionContext, setSessionOrganization } from "@/lib/auth";
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
    if (!session.emailVerified)
      throw new HttpError(
        403,
        "Verify your email before creating an organisation.",
      );
    if (session.organizationId)
      throw new HttpError(
        409,
        "Your organisation has already been configured.",
      );

    const input = onboardingSchema.parse(await readJson(request));
    const organizationId = randomUUID();
    const companyId = randomUUID();
    const branchId = randomUUID();

    await transaction(async (client) => {
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
    });

    const contextUpdated = await setSessionOrganization(
      session.sessionId,
      session.userId,
      organizationId,
    );
    if (!contextUpdated) {
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
    });

    return ok(
      { message: "Your organisation workspace is ready.", next: "/dashboard" },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
