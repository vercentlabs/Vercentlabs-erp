import { z } from "zod";

import { listPosCashMovements, recordPosCashMovement } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const movementSchema = z.object({
  movementType: z.enum(["paid_in", "paid_out"]),
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listPosCashMovements(client, posContext(session), id);
    return ok({ rows });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.cash.adjust", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = movementSchema.parse(await readJson(request));
    const result = await recordPosCashMovement(client, posContext(session), id, input);
    return ok({ movement: result }, 201);
  });
}
