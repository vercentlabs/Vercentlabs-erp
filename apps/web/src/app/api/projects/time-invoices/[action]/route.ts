import { createSalesInvoiceDraftFromTime, getTimeInvoiceExceptions, recordTimeBillingDisposition, reconcileTimeInvoices } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// GET exceptions?projectId= · POST draft { requestIds, invoiceDate?, idempotencyKey } (a Sales user drafts from authorized requests) · reconcile { projectId? }
// (read Sales' outcomes back) · disposition { requestId, documentId, minutes?, disposition, reason }.
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    if (action !== "exceptions") throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    return { rows: await getTimeInvoiceExceptions(client, context, { projectId: url.searchParams.get("projectId") ?? undefined }) };
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action === "draft") return createSalesInvoiceDraftFromTime(client, context, input);
    if (action === "reconcile") return reconcileTimeInvoices(client, context, input);
    if (action === "disposition") return recordTimeBillingDisposition(client, context, String(input.requestId ?? ""), input);
    throw new HttpError(404, "Unknown action.", "NOT_FOUND");
  });
}
