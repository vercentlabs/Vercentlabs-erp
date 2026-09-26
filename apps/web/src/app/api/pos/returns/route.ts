import { z } from "zod";

import { createPointOfSaleReturn, listPointOfSaleResource } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

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
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const rows = await listPointOfSaleResource(client, posContext(session), "returns", {
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
      shiftId: url.searchParams.get("shiftId") || null,
    });
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.return.create", billingWrite: true }, async ({ client, session }) => {
    const input = createReturnSchema.parse(await readJson(request));
    const result = await createPointOfSaleReturn(client, posContext(session), input);
    return ok({ posReturn: result }, 201);
  });
}
