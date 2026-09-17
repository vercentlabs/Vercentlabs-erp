import { z } from "zod";

import { assertSameOriginOrMobile, applyPosCartCoupon, removePosCartCoupon } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const couponSchema = z.object({
  code: z.string().trim().min(1).max(40),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = couponSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create");
      return applyPosCartCoupon(client, posContext(session), id, input);
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
      await requirePosAccess(client, session, "pos.sale.create");
      return removePosCartCoupon(client, posContext(session), id, {
        expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
      });
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}
