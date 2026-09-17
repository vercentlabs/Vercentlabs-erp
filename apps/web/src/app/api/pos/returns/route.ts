import { z } from "zod";

import { assertSameOriginOrMobile, createPointOfSaleReturn, listPointOfSaleResource } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const returnLineSchema = z.object({
  saleLineId: z.string().uuid(),
  quantity: z.number().positive(),
  refundAmount: z.number().min(0).optional().nullable(),
  restock: z.boolean().optional(),
});

const createReturnSchema = z.object({
  saleId: z.string().uuid(),
  lines: z.array(returnLineSchema).min(1),
  reason: z.string().trim().min(1).max(1_000),
  refundTotal: z.number().min(0).optional().nullable(),
  returnNumber: z.string().trim().max(60).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPointOfSaleResource(client, posContext(session), "returns", {
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
        shiftId: url.searchParams.get("shiftId") || null,
      });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = createReturnSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.return.create");
      return createPointOfSaleReturn(client, posContext(session), input);
    });
    return ok({ posReturn: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
