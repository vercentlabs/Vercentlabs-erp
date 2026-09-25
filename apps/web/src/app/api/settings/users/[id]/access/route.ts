import { z } from "zod";

import { setUserAccessScope } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const putSchema = z.object({
  companyIds: z.array(z.string().uuid()).max(200),
  branchIds: z.array(z.string().uuid()).max(500),
});

// The one atomic user access-scope mutation: target-in-scope check, grant
// ceiling, branch→company validation, diff apply, evidence and audit all
// happen inside setUserAccessScope.
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersManage, action: "settings.user_access.update", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const body = putSchema.parse(await readJson(request));
      return ok({ access: await setUserAccessScope(client, session, id, body) });
    },
  );
}
