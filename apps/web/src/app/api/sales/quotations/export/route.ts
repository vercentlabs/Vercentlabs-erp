import { exportQuotations } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { csvResponse, quotationFiltersFromUrl } from "@/features/sales/quotations/server/quotation-http";
import { salesContext } from "@/features/sales/shared/sales-context";

export async function GET(request: Request) {
  const filters = quotationFiltersFromUrl(new URL(request.url));
  return workspaceRoute(request, { module: "sales", permission: "sales.quotation.export" }, async ({ client, session }) => {
    const exported = await exportQuotations(client, salesContext(session), filters);
    return csvResponse(exported.csv, exported.fileName);
  });
}
