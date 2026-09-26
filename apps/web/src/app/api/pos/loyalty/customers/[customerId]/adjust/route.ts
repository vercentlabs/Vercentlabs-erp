import { z } from "zod";

import { adjustPosCustomerLoyaltyBalance } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const adjustSchema = z.object({
  points: z.number().refine((value) => value !== 0, "Adjustment points must not be zero."),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(request: Request, context: { params: Promise<{ customerId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.loyalty.manage", billingWrite: true }, async ({ client, session }) => {
    const { customerId } = await context.params;
    const input = adjustSchema.parse(await readJson(request));
    const result = await adjustPosCustomerLoyaltyBalance(client, posContext(session), customerId, input.points, input.reason);
    return ok({ balance: result });
  });
}
