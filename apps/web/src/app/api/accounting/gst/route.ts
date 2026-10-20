import {
  approveGstReturn, exportGstr1Section, fileGstReturn, getGstReturn, inwardGstSummary, listGstRegistrations, listGstReturns, outwardGstSummary, prepareGstr1, reopenGstReturn,
  waiveGstException,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { accountingContext } from "@/features/accounting/shared/accounting-context";
import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Finance › Tax & GST. GET: the registrations and returns (?registrationId); ?id (&section) one return; ?id&export=section its CSV working
// data; ?summary=outward|inward (&registrationId, &from, &to). POST { action: prepare | approve | reopen | file | waive, ... }.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  if (get("export") && get("id")) {
    return workspaceRoute(request, { module: "accounting", permission: "gst.view" }, async ({ client, session }) => {
      const file = await exportGstr1Section(client, accountingContext(session), get("id") as string, get("export") as string);
      return new Response(file.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  }
  return accountingRead(request, async (client, context) => {
    if (get("summary") === "outward") return outwardGstSummary(client, context, { registrationId: get("registrationId"), from: get("from"), to: get("to") });
    if (get("summary") === "inward") return inwardGstSummary(client, context, { registrationId: get("registrationId"), from: get("from"), to: get("to") });
    if (get("id")) return getGstReturn(client, context, get("id") as string, { section: get("section") });
    return { registrations: await listGstRegistrations(client, context), returns: await listGstReturns(client, context, { registrationId: get("registrationId") }) };
  }, "gst.view");
}
export async function POST(request: Request) {
  return accountingMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const id = String(input.id ?? "");
    switch (input.action) {
      case "prepare": return prepareGstr1(client, context, input);
      case "approve": return approveGstReturn(client, context, id);
      case "reopen": return reopenGstReturn(client, context, id, input);
      case "file": return fileGstReturn(client, context, id, input);
      case "waive": return waiveGstException(client, context, String(input.exceptionId ?? ""), input);
      default: throw new HttpError(400, "Unknown action.");
    }
  }, 200, "gst.view");
}
