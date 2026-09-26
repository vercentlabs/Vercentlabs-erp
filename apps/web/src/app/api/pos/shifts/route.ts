import { z } from "zod";

import { listPointOfSaleResource, openShift } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const openShiftSchema = z.object({
  storeId: z.string().uuid(),
  terminalId: z.string().uuid(),
  cashierUserId: z.string().uuid().optional().nullable(),
  openingCash: z.number().min(0).optional(),
  shiftNumber: z.string().trim().min(1).max(60).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const withTotal = url.searchParams.get("withTotal") === "1";
    const result = await listPointOfSaleResource(client, posContext(session), "shifts", {
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
      storeId: url.searchParams.get("storeId") || undefined,
      terminalId: url.searchParams.get("terminalId") || undefined,
      status: url.searchParams.get("status") || undefined,
      cashierUserId: url.searchParams.get("cashierUserId") || undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      withTotal,
    });
    return ok(withTotal ? (result as { rows: unknown[]; total: number }) : { rows: result });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.shift.open", billingWrite: true }, async ({ client, session }) => {
    const input = openShiftSchema.parse(await readJson(request));
    const result = await openShift(client, posContext(session), input);
    return ok({ shift: result }, 201);
  });
}
