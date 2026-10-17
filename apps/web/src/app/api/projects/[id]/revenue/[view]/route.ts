import { allocateContractLine, allocateInvoiceLine, getProjectRevenueView, reconcileProjectRevenue, saveRevenueForecast } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// GET contracts · invoices · recognition · collections · unbilled · schedule · exceptions · forecasts · reconciliation
// POST contract-allocation { salesOrderId, lineSequence, amount, quantity?, reason } · invoice-allocation { invoiceLineId, amount, reason }
//      · forecast { expectedFurtherRevenue, asOfDate?, assumptions }
type Params = { params: Promise<{ id: string; view: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return projectsRead(request, async (client, context) => (view === "reconciliation" ? reconcileProjectRevenue(client, context, id) : getProjectRevenueView(client, context, id, view)));
}
export async function POST(request: Request, ctx: Params) {
  const { id, view } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (view === "contract-allocation") return allocateContractLine(client, context, id, input);
    if (view === "invoice-allocation") return allocateInvoiceLine(client, context, id, input);
    if (view === "forecast") return saveRevenueForecast(client, context, id, input);
    throw new HttpError(404, "Unknown revenue action.", "NOT_FOUND");
  });
}
