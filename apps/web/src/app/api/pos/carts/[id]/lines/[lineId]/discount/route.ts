import { z } from "zod";

import { assertSameOriginOrMobile, applyPosCartLineDiscount, removePosCartLineDiscount } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

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
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, lineId } = await context.params;
    const input = discountSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.discount.apply", { mutation: true });
      return applyPosCartLineDiscount(client, posContext(session), id, lineId, input);
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, lineId } = await context.params;
    const url = new URL(request.url);
    const expectedVersion = url.searchParams.get("expectedVersion");
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.discount.apply", { mutation: true });
      return removePosCartLineDiscount(client, posContext(session), id, lineId, {
        expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
      });
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}
