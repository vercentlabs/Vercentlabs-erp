import {
  getProjectProfitabilityBreakdown, getProjectProfitabilityExceptions, getProjectProfitabilityHistory, getProjectProfitabilityTrend, reconcileProjectProfitability, recordProfitabilitySnapshot,
  saveProfitabilityForecast,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// GET breakdown · trend (?from=&to=) · history · exceptions · reconciliation
// POST forecast { estimateToComplete, commitmentTreatment, expectedFurtherRevenue?, assumptions, expectedCostForecastVersion? } · snapshot { note? }
type Params = { params: Promise<{ id: string; view: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    const period = { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined };
    if (view === "breakdown") return getProjectProfitabilityBreakdown(client, context, id, period);
    if (view === "trend") return getProjectProfitabilityTrend(client, context, id, period);
    if (view === "history") return getProjectProfitabilityHistory(client, context, id);
    if (view === "exceptions") return getProjectProfitabilityExceptions(client, context, id);
    if (view === "reconciliation") return reconcileProjectProfitability(client, context, id);
    throw new HttpError(404, "Unknown profitability view.", "NOT_FOUND");
  });
}
export async function POST(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (view === "forecast") return saveProfitabilityForecast(client, context, id, input);
    if (view === "snapshot") return recordProfitabilitySnapshot(client, context, id, input);
    throw new HttpError(404, "Unknown profitability action.", "NOT_FOUND");
  });
}
