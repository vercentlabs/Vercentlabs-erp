import { analyzeCustomerImport } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerUpload, readUpload } from "@/features/sales/customers/server/customer-http";

// Import step 1: read the file and propose a column mapping.
export async function POST(request: Request) {
  return customerUpload(request, SALES_PERMISSIONS.customersImport, async (client, context) => {
    const upload = await readUpload(request);
    return { analysis: await analyzeCustomerImport(client, context, { bytes: upload.bytes, fileName: upload.fileName }) };
  });
}
