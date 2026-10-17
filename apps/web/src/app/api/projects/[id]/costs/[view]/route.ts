import { applyProjectOverhead, getProjectCostExceptions, getProjectCostTransactions, proposeProjectBudget, reconcileProjectCost, saveProjectCostForecast } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// GET transactions?from=&to=&category=&source=&taskId=&milestoneId= · exceptions · reconciliation
// POST budget { lines, reason } · forecast { estimateToComplete, commitmentTreatment, asOfDate?, notes? } · overhead { periodStart, periodEnd }
type Params = { params: Promise<{ id: string; view: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    const filters = Object.fromEntries(["from", "to", "category", "source", "taskId", "milestoneId"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
    if (view === "transactions") return getProjectCostTransactions(client, context, id, filters);
    if (view === "exceptions") return { rows: await getProjectCostExceptions(client, context, id) };
    if (view === "reconciliation") return reconcileProjectCost(client, context, id);
    throw new HttpError(404, "Unknown cost view.", "NOT_FOUND");
  });
}
export async function POST(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (view === "budget") return proposeProjectBudget(client, context, id, input);
    if (view === "forecast") return saveProjectCostForecast(client, context, id, input);
    if (view === "overhead") return applyProjectOverhead(client, context, id, input);
    throw new HttpError(404, "Unknown cost action.", "NOT_FOUND");
  });
}
