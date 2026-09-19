import { z } from "zod";

import { assertSameOriginOrMobile, adjustPosCustomerLoyaltyBalance } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const adjustSchema = z.object({
  points: z.number().refine((value) => value !== 0, "Adjustment points must not be zero."),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(request: Request, context: { params: Promise<{ customerId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { customerId } = await context.params;
    const input = adjustSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.loyalty.manage", { mutation: true });
      return adjustPosCustomerLoyaltyBalance(client, posContext(session), customerId, input.points, input.reason);
    });
    return ok({ balance: result });
  } catch (error) {
    return errorResponse(error);
  }
}
