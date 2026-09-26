import { z } from "zod";

import { recordPosReconciliationCorrection } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const correctionSchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
  adjustment: z.array(z.record(z.string(), z.any())).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.reconciliation.approve" }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = correctionSchema.parse(await readJson(request));
    const result = await recordPosReconciliationCorrection(client, posContext(session), id, input);
    return ok({ correction: result }, 201);
  });
}
