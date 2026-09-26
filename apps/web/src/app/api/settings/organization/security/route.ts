import { z } from "zod";

import { audit, getOrganizationMfaEnforcement, setOrganizationMfaEnforcement } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// SP007 "Organization-enforced MFA". Any member may see whether it is on;
// changing it needs platform.security.manage (also enforced inside
// setOrganizationMfaEnforcement).
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "organization.security.view" }, async ({ client, session }) =>
    ok({ mfaEnforced: await getOrganizationMfaEnforcement(client, session.organizationId) }),
  );
}

const putSchema = z.object({ mfaEnforced: z.boolean() });

export async function PUT(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.platformSecurityManage, action: "organization.security.update", auditDenial: true }, async ({ client, session }) => {
    const updated = await setOrganizationMfaEnforcement(client, session, putSchema.parse(await readJson(request)).mfaEnforced);
    await audit(client, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "auth.mfa.organization_policy_changed",
      entityType: "organization",
      entityId: session.organizationId,
      request,
      env: process.env,
    });
    return ok(updated);
  });
}
