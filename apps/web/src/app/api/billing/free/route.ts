import { switchTrialToFree } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// A company on its Standard trial moves to the Free plan instead of paying (owner or administrator).
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.manage, action: "billing.plan.free", auditDenial: true },
    async ({ client, session }) => {
      const ctx = { organizationId: session.organizationId, userId: session.userId, roleSlugs: session.roleSlugs };
      return ok(await switchTrialToFree(client, ctx));
    },
  );
}
