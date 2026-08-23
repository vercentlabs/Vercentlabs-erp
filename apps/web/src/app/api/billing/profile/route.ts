import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { billingProfileSchema } from "@/core/billing-validation";
import { query } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";

export async function PATCH(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.billingManage);
    const input = billingProfileSchema.parse(await readJson(request));
    await query(
      `
        INSERT INTO billing_customers (
          organization_id, legal_name, billing_email, phone, gstin, billing_address
        ) VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6::jsonb)
        ON CONFLICT (organization_id) DO UPDATE SET
          legal_name = EXCLUDED.legal_name,
          billing_email = EXCLUDED.billing_email,
          phone = EXCLUDED.phone,
          gstin = EXCLUDED.gstin,
          billing_address = EXCLUDED.billing_address
      `,
      [
        session.organizationId,
        input.legalName,
        input.billingEmail,
        input.phone || null,
        input.gstin,
        JSON.stringify({
          line1: input.addressLine1,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          country: input.country,
        }),
      ],
    );
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "billing.profile.updated",
      entityType: "billing_customer",
      entityId: session.organizationId,
      afterData: { ...input, gstin: input.gstin || null },
      request,
    });
    return ok({ message: "Billing profile updated." });
  } catch (error) {
    return errorResponse(error);
  }
}
