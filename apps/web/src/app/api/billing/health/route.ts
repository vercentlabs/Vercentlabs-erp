import { getBillingHealth } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Operational billing health for billing.audit holders. No secrets, raw
// payloads or payment-instrument data.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.audit, action: "billing.health", transaction: "none" },
    async ({ client, session }) => ok({ health: await getBillingHealth(client, session.organizationId) }),
  );
}
