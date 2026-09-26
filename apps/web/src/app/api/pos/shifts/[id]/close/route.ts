import { z } from "zod";

import { closeShift } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const closeShiftSchema = z.object({
  countedCash: z.number().min(0),
  closeNotes: z.string().trim().max(2_000).optional().nullable(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.shift.close", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = closeShiftSchema.parse(await readJson(request));
    const result = await closeShift(client, posContext(session), id, input);
    return ok({ shift: result });
  });
}
