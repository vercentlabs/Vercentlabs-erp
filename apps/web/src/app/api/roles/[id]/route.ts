import { getSessionContext } from "@/core/auth";
import {
  analyzePermissionConflicts,
  permissionsOutsideGrantCeiling,
} from "@/core/access-control";
import { recordRoleSnapshot } from "@/core/access-admin";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { transaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { roleSchema } from "@/core/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const organizationId = session.organizationId;
    requirePermissionFromSession(session, PERMISSIONS.rolesManage);
    await requireBillingWriteAccess(organizationId);
    const { id } = await context.params;
    const input = roleSchema.parse(await readJson(request));
    const permissionKeys = [...new Set(input.permissionKeys)].sort();
    const outsideCeiling = permissionsOutsideGrantCeiling(
      session.roleSlugs,
      session.permissions,
      permissionKeys,
    );
    if (outsideCeiling.length) {
      throw new HttpError(
        403,
        `You cannot add permissions you do not hold: ${outsideCeiling.join(", ")}.`,
      );
    }
    const conflicts = analyzePermissionConflicts(permissionKeys);
    const blocking = conflicts.filter((item) => item.severity === "blocking");
    if (blocking.length) {
      throw new HttpError(
        409,
        `This role violates separation of duties: ${blocking
          .map((item) => item.description)
          .join(" ")}`,
      );
    }
    const warnings = conflicts.filter((item) => item.severity === "warning");
    if (warnings.length && !input.acknowledgeWarningConflicts) {
      throw new HttpError(
        409,
        `Review and acknowledge these access conflicts: ${warnings
          .map((item) => item.description)
          .join(" ")}`,
      );
    }
    if (
      warnings.length &&
      !session.roleSlugs.includes("organization_owner") &&
      !session.permissions.includes(PERMISSIONS.accessSodOverride)
    ) {
      throw new HttpError(
        403,
        "You cannot acknowledge access-conflict warnings.",
      );
    }

    await transaction(async (client) => {
      const roleResult = await client.query<{
        is_system: boolean;
        version: number;
      }>(
        "SELECT is_system,version FROM roles WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [id, organizationId],
      );
      const role = roleResult.rows[0];
      if (!role) throw new HttpError(404, "Role not found.");
      if (role.is_system)
        throw new HttpError(
          400,
          "System roles cannot be rewritten. Clone or create a custom role instead.",
        );
      const moduleResult = await client.query(
        `SELECT 1 FROM organization_modules
          WHERE organization_id=$1 AND module_key=$2 AND status='enabled'`,
        [organizationId, input.moduleKey],
      );
      if (input.moduleKey !== "platform" && !moduleResult.rows[0]) {
        throw new HttpError(
          409,
          "This module is not enabled for the organisation.",
        );
      }
      const valid = await client.query<{ key: string }>(
        "SELECT key FROM permissions WHERE key = ANY($1::text[])",
        [permissionKeys],
      );
      if (valid.rows.length !== permissionKeys.length)
        throw new HttpError(400, "One or more permissions are invalid.");
      await client.query(
        `UPDATE roles SET name=$3,slug=$4,description=$5,module_key=$6,
            risk_level=$7,version=version+1,updated_at=now()
          WHERE id=$1 AND organization_id=$2`,
        [
          id,
          organizationId,
          input.name,
          input.slug,
          input.description,
          input.moduleKey,
          input.riskLevel,
        ],
      );
      await client.query("DELETE FROM role_permissions WHERE role_id=$1", [id]);
      for (const key of permissionKeys) {
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_key) VALUES($1,$2)",
          [id, key],
        );
      }
      await recordRoleSnapshot(client, {
        organizationId,
        roleId: id,
        actorUserId: session.userId,
        reason: `Custom role updated from version ${role.version}`,
      });
      await client.query(
        `UPDATE sessions SET revoked_at=now(),revoked_reason='role_permissions_changed'
          WHERE user_id IN (
            SELECT user_id FROM user_role_assignments
            WHERE organization_id=$1 AND role_id=$2 AND status='active'
          ) AND revoked_at IS NULL`,
        [organizationId, id],
      );
    });
    await audit({
      organizationId,
      actorUserId: session.userId,
      eventType: "access.role_updated",
      entityType: "role",
      entityId: id,
      afterData: { ...input, permissionKeys },
      request,
    });
    return ok({ message: "Role updated and affected sessions revoked." });
  } catch (error) {
    return errorResponse(error);
  }
}
