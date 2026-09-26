import { z } from "zod";

import { approvePointOfSaleReturn } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const approveReturnSchema = z.object({
  reason: z.string().trim().max(1_000).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.return.approve", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = approveReturnSchema.parse(await readJson(request));
    const result = await approvePointOfSaleReturn(client, posContext(session), id, input);
    return ok({ posReturn: result });
  });
}
