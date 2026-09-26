import { z } from "zod";

import { resolvePosReconciliation } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const resolveSchema = z.object({
  resolutionNotes: z.string().trim().min(1).max(2_000),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.reconciliation.approve" }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = resolveSchema.parse(await readJson(request));
    const result = await resolvePosReconciliation(client, posContext(session), id, input);
    return ok({ reconciliation: result });
  });
}
