import { z } from "zod";

import { audit, setUserBranchAccess, setUserCompanyAccess } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const putSchema = z.object({
  companyIds: z.array(z.string().uuid()).max(200),
  branchIds: z.array(z.string().uuid()).max(200),
});

// Company/branch access grants for a member. users.manage is checked by the
// Shared Access route composition AND again inside setUserCompanyAccess/
// setUserBranchAccess. Delegated-administrator scope containment for this
// path is a Prompt 2 item (see SHARED_PLATFORM_ARCHITECTURE.md, known gaps).
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersManage, action: "settings.user_access.update", transaction: "platform" },
    async ({ client, session }) => {
      const { id } = await context.params;
      const body = putSchema.parse(await readJson(request));
      const companies = await setUserCompanyAccess(client, session, id, body.companyIds);
      const branches = await setUserBranchAccess(client, session, id, body.branchIds);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "user.access_updated",
        entityType: "organization_membership",
        entityId: id,
        request,
        env: process.env,
      });
      return ok({ ...companies, ...branches });
    },
  );
}
