import { exportCustomers } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, customerFiltersFromUrl, customerRead } from "@/features/sales/customers/server/customer-http";

// Downloads the customers the list shows for the same view and filters.
export async function GET(request: Request) {
  return customerRead(request, SALES_PERMISSIONS.customersExport, async (client, context) => {
    const exported = await exportCustomers(client, context, customerFiltersFromUrl(new URL(request.url)));
    return csvResponse(exported.csv, exported.fileName);
  });
}
