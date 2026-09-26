import { z } from "zod";

import { requestPosPaymentOverride } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// Requests a manual force-capture override for a payment a provider could
// not confirm (e.g. a terminal that went offline). This never itself
// accepts the payment -- it opens a real maker-checker approval request
// (services/api/src/core/approvals.js) that a DIFFERENT identity holding
// pos.payment.override must decide before the leg is ever marked captured.
const overrideSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.payment.override", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = overrideSchema.parse(await readJson(request));
    const result = await requestPosPaymentOverride(client, posContext(session), { paymentId: id, reason: input.reason });
    return ok(result, 201);
  });
}
