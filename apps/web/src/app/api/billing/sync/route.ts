import { syncSubscriptionFromProvider } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { billingProvider } from "@/features/billing/provider";

// "Refresh status": finish a pending verification and reconcile with the provider.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.manage, transaction: "none", action: "billing.reconcile" },
    async ({ client, session }) =>
      ok(await syncSubscriptionFromProvider(client, { organizationId: session.organizationId, userId: session.userId }, billingProvider())),
  );
}
