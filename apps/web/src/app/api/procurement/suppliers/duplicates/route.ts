import { checkSupplierDuplicates, supplierCan } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";
import { HttpError } from "@/core/http";

// The duplicate check shown while a supplier is typed. Body: the identifying fields; excludeSupplierId when editing.
export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    if (!supplierCan(context, "procurement.suppliers.create") && !supplierCan(context, "procurement.suppliers.edit")) throw new HttpError(403, "You do not have permission to do this.");
    const excludeSupplierId = typeof input.excludeSupplierId === "string" ? input.excludeSupplierId : null;
    return { matches: await checkSupplierDuplicates(client, context, input, { excludeSupplierId }) };
  });
}
