import { exportCustomerRelated } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, customerFiltersFromUrl, customerRead } from "@/features/sales/customers/server/customer-http";

type Params = { params: Promise<{ kind: string }> };

// Downloads the addresses or the contacts of the customers the list shows.
export async function GET(request: Request, { params }: Params) {
  const { kind } = await params;
  return customerRead(request, SALES_PERMISSIONS.customersExport, async (client, context) => {
    const exported = await exportCustomerRelated(client, context, kind, customerFiltersFromUrl(new URL(request.url)));
    return csvResponse(exported.csv, exported.fileName);
  });
}
