import { buildSupplierImportTemplate } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { csvResponse } from "@/features/procurement/suppliers/server/supplier-http";

// The downloadable import template: every importable column and one sample row.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "procurement", permission: "procurement.suppliers.import" }, async () =>
    csvResponse(buildSupplierImportTemplate(), "supplier-import-template.csv"));
}
