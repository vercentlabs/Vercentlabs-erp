import { z } from "zod";

import { generatePosReconciliation } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const generateSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.reconciliation.manage" }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = generateSchema.parse(await readJson(request));
    const result = await generatePosReconciliation(client, posContext(session), id, input);
    return ok(result, 201);
  });
}
