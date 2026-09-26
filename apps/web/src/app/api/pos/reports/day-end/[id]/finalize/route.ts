import { z } from "zod";

import { finalizePosDayEndReport } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const finalizeSchema = z.object({
  closeNotes: z.string().trim().max(2_000).optional().nullable(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.report.finalize" }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = finalizeSchema.parse(await readJson(request));
    const result = await finalizePosDayEndReport(client, posContext(session), id, input);
    return ok({ report: result });
  });
}
