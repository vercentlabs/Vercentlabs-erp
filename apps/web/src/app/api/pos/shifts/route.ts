import { z } from "zod";

import { assertSameOriginOrMobile, listPointOfSaleResource, openShift } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const openShiftSchema = z.object({
  storeId: z.string().uuid(),
  terminalId: z.string().uuid(),
  cashierUserId: z.string().uuid().optional().nullable(),
  openingCash: z.number().min(0).optional(),
  shiftNumber: z.string().trim().min(1).max(60).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPointOfSaleResource(client, posContext(session), "shifts", {
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
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
    const input = openShiftSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.shift.open", { mutation: true });
      return openShift(client, posContext(session), input);
    });
    return ok({ shift: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
