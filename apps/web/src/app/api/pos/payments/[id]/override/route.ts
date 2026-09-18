import { z } from "zod";

import { assertSameOriginOrMobile, requestPosPaymentOverride } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// Requests a manual force-capture override for a payment a provider could
// not confirm (e.g. a terminal that went offline). This never itself
// accepts the payment -- it opens a real maker-checker approval request
// (services/api/src/core/approvals.js) that a DIFFERENT identity holding
// pos.payment.override must decide before the leg is ever marked captured.
const overrideSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = overrideSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.payment.override");
      return requestPosPaymentOverride(client, posContext(session), { paymentId: id, reason: input.reason });
    });
    return ok(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
