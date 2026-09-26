import { z } from "zod";

import { reviewPosDayEndReport } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const reviewSchema = z.object({
  reviewNotes: z.string().trim().max(2_000).optional().nullable(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.report.generate" }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = reviewSchema.parse(await readJson(request));
    const result = await reviewPosDayEndReport(client, posContext(session), id, input);
    return ok({ report: result });
  });
}
