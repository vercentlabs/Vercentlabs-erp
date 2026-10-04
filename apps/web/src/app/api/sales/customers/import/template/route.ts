import { buildCustomerImportTemplate } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, customerRead } from "@/features/sales/customers/server/customer-http";

export async function GET(request: Request) {
  return customerRead(request, SALES_PERMISSIONS.customersImport, async () => csvResponse(buildCustomerImportTemplate(), "customer-import-template.csv"));
}
