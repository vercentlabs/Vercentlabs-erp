import { analyzeCustomerRelatedImport } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerUpload, readUpload } from "@/features/sales/customers/server/customer-http";

type Params = { params: Promise<{ kind: string }> };

// Address or contact import, step 1: read the file and propose a mapping.
export async function POST(request: Request, { params }: Params) {
  const { kind } = await params;
  return customerUpload(request, SALES_PERMISSIONS.customersImport, async (client, context) => {
    const upload = await readUpload(request);
    return { analysis: await analyzeCustomerRelatedImport(client, context, kind, { bytes: upload.bytes, fileName: upload.fileName }) };
  });
}
