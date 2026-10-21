import {
  confirmGstr2bMatchedCredit, exportGstr3b, listGstDocumentObligations, getGstr2bReconciliation, importGstr2b, listItcAdjustments, prepareGstr3b, reclaimInputTaxCredit, reverseInputTaxCredit,
  approveGstReturn, exportGstr1Section, fileGstReturn, getGstReturn, inwardGstSummary, listGstRegistrations, listGstReturns, outwardGstSummary, prepareGstr1, reopenGstReturn,
  waiveGstException,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { gstRoute, readBody } from "@/features/accounting/gst/gst-route";

// Finance › Tax & GST. GET: the registrations and returns (?registrationId); ?id (&section) one return; ?id&export=section its CSV working
// data (export=3b: the GSTR-3B working paper); ?twoB=1&period: GSTR-2B against the books and the ITC adjustments; ?summary=outward|inward
// (&registrationId, &from, &to). POST { action: prepare | prepare3b | approve | reopen | file | waive | import2b | confirm2b | reverseItc | reclaimItc, ... }.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  if (get("export") && get("id")) {
    return gstRoute(request, "gst.view", async (client, context) => {
      const file = get("export") === "3b" ? await exportGstr3b(client, context, get("id") as string) : await exportGstr1Section(client, context, get("id") as string, get("export") as string);
      return new Response(file.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  }
  return gstRoute(request, "gst.view", async (client, context) => {
    if (get("summary") === "outward") return outwardGstSummary(client, context, { registrationId: get("registrationId"), from: get("from"), to: get("to") });
    if (get("summary") === "inward") return inwardGstSummary(client, context, { registrationId: get("registrationId"), from: get("from"), to: get("to") });
    if (get("id")) return getGstReturn(client, context, get("id") as string, { section: get("section") });
    if (get("obligations")) return listGstDocumentObligations(client, context, { from: get("from"), to: get("to") });
    if (get("twoB")) return { ...(await getGstr2bReconciliation(client, context, { registrationId: get("registrationId"), period: get("period") })),
      adjustments: await listItcAdjustments(client, context, { registrationId: get("registrationId") }) };
    return { registrations: await listGstRegistrations(client, context), returns: await listGstReturns(client, context, { registrationId: get("registrationId") }) };
  });
}
export async function POST(request: Request) {
  return gstRoute(request, "gst.view", async (client, context) => {
    const input = z.record(z.string(), z.unknown()).parse(await readBody(request));
    const id = String(input.id ?? "");
    switch (input.action) {
      case "prepare": return prepareGstr1(client, context, input);
      case "prepare3b": return prepareGstr3b(client, context, input);
      case "import2b": return importGstr2b(client, context, input);
      case "confirm2b": return confirmGstr2bMatchedCredit(client, context, input);
      case "reverseItc": return reverseInputTaxCredit(client, context, input);
      case "reclaimItc": return reclaimInputTaxCredit(client, context, String(input.reversalId ?? ""), input);
      case "approve": return approveGstReturn(client, context, id);
      case "reopen": return reopenGstReturn(client, context, id, input);
      case "file": return fileGstReturn(client, context, id, input);
      case "waive": return waiveGstException(client, context, String(input.exceptionId ?? ""), input);
      default: throw new HttpError(400, "Unknown action.");
    }
  }, { write: true });
}
