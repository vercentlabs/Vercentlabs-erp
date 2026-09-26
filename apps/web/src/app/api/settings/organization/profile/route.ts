import { z } from "zod";

import { audit, getOrganizationProfile, updateOrganizationProfile } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Organization. Any member may read the organisation's name and
// timezone; changing them needs organization.manage (also enforced inside
// updateOrganizationProfile).
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "organization.profile.view" }, async ({ client, session }) =>
    ok({ profile: await getOrganizationProfile(client, session.organizationId) }),
  );
}

const putSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
});

export async function PUT(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "organization.profile.update", auditDenial: true }, async ({ client, session }) => {
    const updated = await updateOrganizationProfile(client, session, putSchema.parse(await readJson(request)));
    await audit(client, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "organization.profile.updated",
      entityType: "organization",
      entityId: session.organizationId,
      request,
      env: process.env,
    });
    return ok({ profile: updated });
  });
}
