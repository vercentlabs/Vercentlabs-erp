import { getEInvoiceReadiness, getEwayBillReadiness, recordPortalEInvoice, recordPortalEInvoiceCancellation, recordPortalEwayBill } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError, ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// e-invoice and e-way-bill readiness, and references generated on the government portals. GET ?invoiceId= (e-invoice readiness) or
// ?sourceType=&sourceId= (e-way bill readiness). POST { kind: einvoice | einvoice-cancel | eway, ... } records what the portal returned.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "compliance.readiness.view" }, async ({ client, session }) => {
    const q = new URL(request.url).searchParams;
    if (q.get("invoiceId")) return ok({ readiness: await getEInvoiceReadiness(client, session, q.get("invoiceId") as string) });
    return ok({ readiness: await getEwayBillReadiness(client, session, q.get("sourceType") ?? "", q.get("sourceId") ?? "") });
  });
}
const schema = z.record(z.string(), z.unknown());
export async function POST(request: Request) {
  return workspaceRoute(request, { billingWrite: true, action: "compliance.reference.record", auditDenial: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    switch (input.kind) {
      case "einvoice": return ok({ einvoice: await recordPortalEInvoice(client, session, String(input.invoiceId ?? ""), input) });
      case "einvoice-cancel": return ok(await recordPortalEInvoiceCancellation(client, session, String(input.invoiceId ?? ""), input));
      case "eway": return ok({ ewayBill: await recordPortalEwayBill(client, session, String(input.sourceType ?? ""), String(input.sourceId ?? ""), input) });
      default: throw new HttpError(400, "Unknown reference.");
    }
  });
}
