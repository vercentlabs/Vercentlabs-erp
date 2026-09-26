import { z } from "zod";

import { getPosLoyaltyProgram, upsertPosLoyaltyProgram } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(200),
  earnRatePointsPerCurrency: z.number().positive(),
  redemptionValuePerPoint: z.number().positive(),
  minRedemptionPoints: z.number().min(0).optional(),
  maxRedemptionPointsPerSale: z.number().positive().optional().nullable(),
  maxRedemptionPercentOfPayable: z.number().min(0).max(100).optional().nullable(),
  minEligibleSaleAmount: z.number().min(0).optional(),
  pointsExpiryDays: z.number().int().positive().optional().nullable(),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const record = await getPosLoyaltyProgram(client, posContext(session));
    return ok({ record });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.loyalty.manage", billingWrite: true }, async ({ client, session }) => {
    const input = upsertSchema.parse(await readJson(request));
    const result = await upsertPosLoyaltyProgram(client, posContext(session), input);
    return ok({ record: result });
  });
}
