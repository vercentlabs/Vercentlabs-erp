import { getBillingOverview } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Billing is never behind the billing write gate: an expired or over-limit
// organisation must still be able to open Billing and fix it.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.view, action: "billing.summary" },
    async ({ client, session }) => ok({ overview: await getBillingOverview(client, session.organizationId, process.env) }),
  );
}
