import { createInvoiceFromTime, getInvoiceEligibleProjectTime, previewInvoiceFromTime } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// GET eligible?from=&to=&taskId=&employeeId=&contractLineId= · POST preview { entries, invoiceDate? } (saves nothing) · create { entries, invoiceDate?,
// billingPeriodStart?, billingPeriodEnd?, note?, idempotencyKey } (reserves the minutes and makes the Sales Invoice Draft).
type Params = { params: Promise<{ id: string; action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    if (action !== "eligible") throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    return getInvoiceEligibleProjectTime(client, context, id, Object.fromEntries(["from", "to", "taskId", "employeeId", "contractLineId"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value)));
  });
}
const entries = z.array(z.object({ entryId: z.string(), minutes: z.number().int().optional(), expectedVersion: z.number().int().optional() })).max(500);
const schema = z.object({ entries, invoiceDate: z.string().optional(), billingPeriodStart: z.string().optional(), billingPeriodEnd: z.string().optional(), note: z.string().max(1000).optional(), idempotencyKey: z.string().max(200).optional() });
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => {
    if (action === "preview") return previewInvoiceFromTime(client, context, id, input);
    if (action === "create") return createInvoiceFromTime(client, context, id, input);
    throw new HttpError(404, "Unknown action.", "NOT_FOUND");
  });
}
