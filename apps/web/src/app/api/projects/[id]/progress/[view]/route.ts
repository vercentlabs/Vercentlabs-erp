import { captureProjectProgressBaseline, explainProgressChange, getBaselineComparison, getProjectProgressHistory, rebuildProjectProgressProjection } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// GET history?interval=week|day&points= · changes?from=&to= · baseline?version=
// POST baseline { reason, idempotencyKey } (a versioned re-baseline) · record (record the current figures and reconcile the history)
type Params = { params: Promise<{ id: string; view: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    const get = (key: string) => url.searchParams.get(key) ?? undefined;
    switch (view) {
      case "history": return getProjectProgressHistory(client, context, id, { interval: get("interval"), points: get("points") });
      case "changes": return explainProgressChange(client, context, id, { from: get("from"), to: get("to") });
      case "baseline": return { baseline: await getBaselineComparison(client, context, id, { version: get("version") ?? null }) };
      default: throw new HttpError(404, "Unknown progress view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return projectsMutation(request, z.object({ reason: z.string().max(1000).optional(), idempotencyKey: z.string().max(200).optional() }), async (client, context, input) => {
    if (view === "baseline") return captureProjectProgressBaseline(client, context, id, input);
    if (view === "record") return rebuildProjectProgressProjection(client, context, id);
    throw new HttpError(404, "Unknown progress action.", "NOT_FOUND");
  });
}
