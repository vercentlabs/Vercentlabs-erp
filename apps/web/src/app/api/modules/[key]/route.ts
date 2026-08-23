import {
  assertModuleEntitlement,
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { requireApiPermission } from "@/core/authorization";
import { query } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { moduleCatalog } from "@/core/platform";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { moduleStatusSchema } from "@/core/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireApiPermission("modules.manage");
    const { key } = await context.params;
    const moduleEntry = moduleCatalog.find((module) => module.key === key);
    if (!moduleEntry) throw new HttpError(404, "Module not found.");
    const input = moduleStatusSchema.parse(await readJson(request));

    if (moduleEntry.availability !== "released") {
      throw new HttpError(
        409,
        `${moduleEntry.name} is on the roadmap and cannot be activated in this release.`,
      );
    }

    await requireBillingWriteAccess(session.organizationId);
    if (input.status === "enabled") {
      // Entitlement only gates turning a module ON — a tenant never needs
      // plan permission to turn one off. See docs/implementation/
      // ERP_AUTHORIZATION_MODEL_004.md, Part 6.
      await assertModuleEntitlement(session.organizationId, key);
    }
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const before = await query<{ module_key: string; status: string }>(
      `SELECT module_key,status FROM organization_modules
       WHERE organization_id=$1 AND module_key=$2`,
      [session.organizationId, key],
    );
    if (!before[0]) throw new HttpError(404, "Module registry entry not found.");

    // Previously this always set status='enabled' regardless of the
    // requested input.status, and separately rejected any *disable*
    // request for a hardcoded 4-module list ("crm"/"sales"/"accounting"/
    // "procurement") — a runtime remnant of the retired four-module launch
    // scope, inconsistent with today's 12-module released catalogue and
    // silently ignored for every other module anyway, since the update
    // never actually disabled anything. Fixed to honor the requested
    // status for every released module uniformly.
    await query(
      `UPDATE organization_modules SET status=$3,
         enabled_at=CASE WHEN $3='enabled' THEN COALESCE(enabled_at,now()) ELSE enabled_at END,
         updated_at=now()
       WHERE organization_id=$1 AND module_key=$2`,
      [session.organizationId, key, input.status],
    );
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "module.status_changed",
      entityType: "organization_module",
      entityId: key,
      beforeData: before[0],
      afterData: { status: input.status },
      request,
    });
    return ok({ message: `${moduleEntry.name} is ${input.status}.` });
  } catch (error) {
    return errorResponse(error);
  }
}
