import { z } from "zod";

import { resolvePosOfflineSyncConflict } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const lineSchema = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  quantity: z.number().positive(),
  discountAmount: z.number().min(0).optional().nullable(),
  discountReason: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  warehouseLocationId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  serialId: z.string().uuid().optional().nullable(),
});

const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("void"), reason: z.string().trim().min(1).max(1000) }),
  z.object({
    action: z.literal("retry"),
    reason: z.string().trim().max(1000).optional(),
    lines: z.array(lineSchema).min(1).optional(),
    payments: z.array(z.object({ method: z.literal("cash"), amount: z.number().positive() })).min(1).optional(),
    shiftId: z.string().uuid().optional(),
  }),
]);

// Human resolution of a queued offline-sync conflict: void (mandatory
// reason, never silent) or retry with an operator-reviewed/adjusted
// line snapshot -- see resolvePosOfflineSyncConflict (services/api/src/
// modules/point-of-sale/index.js) for why a retry re-resolves price fresh
// and uses its own resolution-scoped idempotency key.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.offline.resolve", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = resolveSchema.parse(await readJson(request));
    const result = await resolvePosOfflineSyncConflict(client, posContext(session), id, input);
    return ok({ conflict: result });
  });
}
