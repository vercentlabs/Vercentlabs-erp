import { randomUUID } from "node:crypto";

import { getSessionContext } from "@/lib/auth";
import {
  analyzePermissionConflicts,
  permissionsOutsideGrantCeiling,
} from "@/lib/access-control";
import { recordRoleSnapshot } from "@/lib/access-administration";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { requireBillingWriteAccess } from "@/lib/billing";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOriginOrMobile, audit } from "@/lib/security";
import { roleSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const organizationId = session.organizationId;
    requirePermissionFromSession(session, PERMISSIONS.rolesManage);
    await requireBillingWriteAccess(organizationId);
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

    const id = randomUUID();
    await transaction(async (client) => {
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
        `INSERT INTO roles(
           id,organization_id,name,slug,description,is_system,module_key,
           assignable,risk_level,version
         ) VALUES($1,$2,$3,$4,$5,false,$6,true,$7,1)`,
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
        reason: "Custom role created",
      });
    });
    await audit({
      organizationId,
      actorUserId: session.userId,
      eventType: "access.role_created",
      entityType: "role",
      entityId: id,
      afterData: { ...input, permissionKeys },
      request,
    });
    return ok(
      { message: "Custom role created with versioned access evidence." },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
