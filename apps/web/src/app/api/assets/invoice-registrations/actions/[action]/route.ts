import { getInvoiceExceptions, getInvoiceReconciliation, getInvoiceReport } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET exceptions · reconciliation · report (?kind=)
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "exceptions": return { rows: await getInvoiceExceptions(client, context) };
      case "reconciliation": return getInvoiceReconciliation(client, context);
      case "report": return { rows: await getInvoiceReport(client, context, url.searchParams.get("kind") ?? "invoices-pending-registration") };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
