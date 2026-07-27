import {
  assertModuleEntitlement,
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { requirePermission } from "@/lib/authorization";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { moduleCatalog } from "@/lib/platform";
import { assertSameOriginOrMobile, audit } from "@/lib/security";
import { moduleStatusSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requirePermission("modules.manage");
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
    if (["crm", "sales", "accounting"].includes(key) && input.status !== "enabled") {
      throw new HttpError(409, "Core released modules cannot be disabled.");
    }

    await requireBillingWriteAccess(session.organizationId);
    await assertModuleEntitlement(session.organizationId, key);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const before = await query<{ module_key: string; status: string }>(
      `SELECT module_key,status FROM organization_modules
       WHERE organization_id=$1 AND module_key=$2`,
      [session.organizationId, key],
    );
    if (!before[0]) throw new HttpError(404, "Module registry entry not found.");

    await query(
      `UPDATE organization_modules SET status='enabled',
         enabled_at=COALESCE(enabled_at,now()), updated_at=now()
       WHERE organization_id=$1 AND module_key=$2`,
      [session.organizationId, key],
    );
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "module.status_changed",
      entityType: "organization_module",
      entityId: key,
      beforeData: before[0],
      afterData: { status: "enabled" },
      request,
    });
    return ok({ message: `${moduleEntry.name} is enabled.` });
  } catch (error) {
    return errorResponse(error);
  }
}
