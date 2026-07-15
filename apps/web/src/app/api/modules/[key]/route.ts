import { requirePermission } from "@/lib/authorization";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { moduleCatalog } from "@/lib/platform";
import { assertSameOrigin, audit } from "@/lib/security";
import { moduleStatusSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requirePermission("modules.manage");
    const { key } = await context.params;
    if (!moduleCatalog.some((module) => module.key === key))
      throw new HttpError(404, "Module not found.");
    const input = moduleStatusSchema.parse(await readJson(request));
    const before = await query<{ module_key: string; status: string }>(
      `
      SELECT module_key,status FROM organization_modules WHERE organization_id=$1 AND module_key=$2
    `,
      [session.organizationId, key],
    );
    if (!before[0])
      throw new HttpError(404, "Module registry entry not found.");
    await query(
      `
      UPDATE organization_modules SET status=$3,
        enabled_at=CASE WHEN $3='enabled' THEN COALESCE(enabled_at,now()) ELSE NULL END,
        updated_at=now()
      WHERE organization_id=$1 AND module_key=$2
    `,
      [session.organizationId, key, input.status],
    );
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "module.status_changed",
      entityType: "organization_module",
      entityId: key,
      beforeData: before[0],
      afterData: input,
      request,
    });
    return ok({ message: "Module status updated." });
  } catch (error) {
    return errorResponse(error);
  }
}
