import { z } from "zod";

import { assertSameOriginOrMobile, getPosLoyaltyProgram, upsertPosLoyaltyProgram } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

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

export async function GET() {
  try {
    const session = await requireWorkspace();
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return getPosLoyaltyProgram(client, posContext(session));
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = upsertSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.loyalty.manage", { mutation: true });
      return upsertPosLoyaltyProgram(client, posContext(session), input);
    });
    return ok({ record: result });
  } catch (error) {
    return errorResponse(error);
  }
}
