import { buildCustomerRelatedImportTemplate } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { csvResponse, customerRead } from "@/features/sales/customers/server/customer-http";

type Params = { params: Promise<{ kind: string }> };

export async function GET(request: Request, { params }: Params) {
  const { kind } = await params;
  return customerRead(request, SALES_PERMISSIONS.customersImport, async () => csvResponse(buildCustomerRelatedImportTemplate(kind), `customer-${kind}-import-template.csv`));
}
