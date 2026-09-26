import { z } from "zod";

import { recordPosDayEndVariance } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const varianceSchema = z.object({
  varianceType: z.enum(["cash_variance", "total_adjustment", "reclassification", "other"]),
  reason: z.string().trim().min(1).max(1_000),
  adjustment: z.array(z.record(z.string(), z.any())).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.report.finalize" }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = varianceSchema.parse(await readJson(request));
    const result = await recordPosDayEndVariance(client, posContext(session), id, input);
    return ok({ correction: result }, 201);
  });
}
