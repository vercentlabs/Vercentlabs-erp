import { importCustomerRelated } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { customerUpload, readUpload } from "@/features/sales/customers/server/customer-http";

type Params = { params: Promise<{ kind: string }> };

// Address or contact import, step 2. Multipart fields: file, mapping (JSON
// { header: field }), dryRun.
export async function POST(request: Request, { params }: Params) {
  const { kind } = await params;
  return customerUpload(request, SALES_PERMISSIONS.customersImport, async (client, context) => {
    const upload = await readUpload(request);
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(upload.field("mapping") || "{}");
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const result = await importCustomerRelated(client, context, kind, { bytes: upload.bytes, fileName: upload.fileName, mapping, dryRun: upload.field("dryRun") === "true" });
    return { result, errorFile: null };
  });
}
