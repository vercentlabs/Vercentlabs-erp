import { exportSuppliers } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";
import { csvResponse, supplierFiltersFromUrl } from "@/features/procurement/suppliers/server/supplier-http";

export async function GET(request: Request) {
  const filters = supplierFiltersFromUrl(new URL(request.url));
  return workspaceRoute(request, { module: "procurement", permission: "procurement.suppliers.export" }, async ({ client, session }) => {
    const result = await exportSuppliers(client, procurementContext(session), filters);
    return csvResponse(result.csv, result.fileName);
  });
}
