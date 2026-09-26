import { listPlanCatalogue } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.view, action: "billing.plans" },
    async ({ client, session }) => ok({ plans: await listPlanCatalogue(client, session.organizationId, process.env) }),
  );
}
