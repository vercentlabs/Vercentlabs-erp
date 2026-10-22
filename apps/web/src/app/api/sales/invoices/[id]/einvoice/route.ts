import { z } from "zod";

import { cancelEInvoice, einvoiceDeadline, generateEInvoice, getEInvoice, gspConfigured } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The invoice's e-invoice (IRN) through the company's GSP: GET what was issued, POST to generate, PATCH { reason, remarks } to cancel.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "sales", permission: "sales.invoice.view", action: "sales.einvoice.view" }, async ({ client, session }) => {
    const { id } = await context.params;
    // The 30-day reporting limit (turnover ₹10 crore or more), while the document has no IRN (Sales plan).
    return ok({ einvoice: await getEInvoice(client, session, id), configured: gspConfigured(process.env), deadline: await einvoiceDeadline(client, session, id) });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "sales", permission: "sales.invoice.post", billingWrite: true, action: "sales.einvoice.generate", auditDenial: true }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok(await generateEInvoice(client, session, id));
  });
}

const cancelSchema = z.object({ reason: z.enum(["duplicate", "data_entry_mistake", "order_cancelled", "other"]), remarks: z.string().max(100).optional() });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "sales", permission: "sales.invoice.post", billingWrite: true, action: "sales.einvoice.cancel", auditDenial: true }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok(await cancelEInvoice(client, session, id, cancelSchema.parse(await readJson(request))));
  });
}
