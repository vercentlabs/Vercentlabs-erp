import { z } from "zod";

import { assertSameOriginOrMobile, redeemPosCartLoyaltyPoints, removePosCartLoyaltyRedemption } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const redeemSchema = z.object({
  points: z.number().positive(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = redeemSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.loyalty.redeem");
      return redeemPosCartLoyaltyPoints(client, posContext(session), id, input);
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const url = new URL(request.url);
    const expectedVersion = url.searchParams.get("expectedVersion");
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.loyalty.redeem");
      return removePosCartLoyaltyRedemption(client, posContext(session), id, {
        expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
      });
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}
