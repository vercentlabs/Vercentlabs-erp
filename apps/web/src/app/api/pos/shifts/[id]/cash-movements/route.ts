import { z } from "zod";

import { assertSameOriginOrMobile, listPosCashMovements, recordPosCashMovement } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const movementSchema = z.object({
  movementType: z.enum(["paid_in", "paid_out"]),
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPosCashMovements(client, posContext(session), id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = movementSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.cash.adjust");
      return recordPosCashMovement(client, posContext(session), id, input);
    });
    return ok({ movement: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
