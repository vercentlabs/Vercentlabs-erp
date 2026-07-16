import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { roleSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.rolesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await context.params;
    const input = roleSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    await transaction(async (client) => {
      const role = await client.query<{ is_system: boolean }>(
        "SELECT is_system FROM roles WHERE id=$1 AND organization_id=$2",
        [id, session.organizationId],
      );
      if (!role.rows[0]) throw new HttpError(404, "Role not found.");
      if (role.rows[0].is_system)
        throw new HttpError(
          400,
          "System roles cannot be rewritten. Create a custom role instead.",
        );
      await client.query(
        "UPDATE roles SET name=$3,slug=$4,description=$5,updated_at=now() WHERE id=$1 AND organization_id=$2",
        [id, session.organizationId, input.name, input.slug, input.description],
      );
      await client.query("DELETE FROM role_permissions WHERE role_id=$1", [id]);
      for (const key of input.permissionKeys)
        await client.query(
          "INSERT INTO role_permissions (role_id,permission_key) VALUES ($1,$2)",
          [id, key],
        );
    });
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "access.role_updated",
      entityType: "role",
      entityId: id,
      afterData: input,
      request,
    });
    return ok({ message: "Role updated." });
  } catch (error) {
    return errorResponse(error);
  }
}
