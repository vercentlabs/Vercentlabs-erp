import { z } from "zod";

import { applyPosCartLineDiscount, removePosCartLineDiscount } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// F279 (POS Session 3): `approvedBy` is deliberately not accepted here --
// a caller can never assert who approved a discount. Above the configured
// threshold, the domain layer creates a real pending approval request
// (see services/api/src/modules/point-of-sale/assortment-pricing-customer-and-cart/cart.js) that only
// a genuinely separate, permission-holding approver can decide, via
// POST /api/approvals/[id]/decide.
const discountSchema = z.object({
  type: z.enum(["percent", "amount"]),
  value: z.number().positive(),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.discount.apply", billingWrite: true }, async ({ client, session }) => {
    const { id, lineId } = await context.params;
    const input = discountSchema.parse(await readJson(request));
    const result = await applyPosCartLineDiscount(client, posContext(session), id, lineId, input);
    return ok({ cart: result });
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.discount.apply", billingWrite: true }, async ({ client, session }) => {
    const { id, lineId } = await context.params;
    const url = new URL(request.url);
    const expectedVersion = url.searchParams.get("expectedVersion");
    const result = await removePosCartLineDiscount(client, posContext(session), id, lineId, {
      expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
    });
    return ok({ cart: result });
  });
}
