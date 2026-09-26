import { cancelPaidSubscription } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { billingProvider } from "@/features/billing/provider";

// Self-service cancellation is always at the end of the paid period.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.manage, transaction: "none", action: "billing.cancel", auditDenial: true },
    async ({ client, session }) =>
      ok(await cancelPaidSubscription(client, { organizationId: session.organizationId, userId: session.userId }, billingProvider())),
  );
}
