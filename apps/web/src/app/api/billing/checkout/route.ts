import { z } from "zod";

import { startSeatCheckout } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { billingProvider } from "@/features/billing/provider";

const schema = z.object({ planPriceId: z.string().uuid().optional(), users: z.number().int().min(1).max(500) });

// transaction "none": the checkout saga commits its intent before calling the
// payment provider and never holds a transaction open across that call.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.checkout, action: "billing.checkout.start", auditDenial: true },
    async ({ client, session }) => {
      const body = schema.parse(await readJson(request));
      const ctx = { organizationId: session.organizationId, userId: session.userId, email: session.email };
      return ok(await startSeatCheckout(client, ctx, body, billingProvider()), 201);
    },
  );
}
