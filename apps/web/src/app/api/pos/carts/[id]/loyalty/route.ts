import { z } from "zod";

import { redeemPosCartLoyaltyPoints, removePosCartLoyaltyRedemption } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const redeemSchema = z.object({
  points: z.number().positive(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.loyalty.redeem", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = redeemSchema.parse(await readJson(request));
    const result = await redeemPosCartLoyaltyPoints(client, posContext(session), id, input);
    return ok({ cart: result });
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.loyalty.redeem", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const expectedVersion = url.searchParams.get("expectedVersion");
    const result = await removePosCartLoyaltyRedemption(client, posContext(session), id, {
      expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
    });
    return ok({ cart: result });
  });
}
