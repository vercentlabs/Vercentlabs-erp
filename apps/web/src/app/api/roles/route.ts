import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { randomUUID } from "node:crypto";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { roleSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.rolesManage);
    await requireBillingWriteAccess(session.organizationId);
    const input = roleSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const id = randomUUID();
    await transaction(async (client) => {
      const valid = await client.query<{ key: string }>(
        "SELECT key FROM permissions WHERE key = ANY($1::text[])",
        [input.permissionKeys],
      );
      if (valid.rows.length !== input.permissionKeys.length)
        throw new HttpError(400, "One or more permissions are invalid.");
      await client.query(
        `INSERT INTO roles (id,organization_id,name,slug,description,is_system) VALUES ($1,$2,$3,$4,$5,false)`,
        [id, session.organizationId, input.name, input.slug, input.description],
      );
      for (const key of input.permissionKeys)
        await client.query(
          "INSERT INTO role_permissions (role_id,permission_key) VALUES ($1,$2)",
          [id, key],
        );
    });
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "access.role_created",
      entityType: "role",
      entityId: id,
      afterData: input,
      request,
    });
    return ok({ message: "Custom role created.", id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
