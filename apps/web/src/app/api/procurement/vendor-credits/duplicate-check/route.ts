import { checkDuplicateSupplierCreditNote } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Whether the supplier's credit note number is already recorded (?supplierId=&number=&excludeCreditId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return procurementRead(request, async (client, context) => checkDuplicateSupplierCreditNote(client, context, { supplierId: url.searchParams.get("supplierId"),
    supplierCreditNoteNumber: url.searchParams.get("number"), excludeCreditId: url.searchParams.get("excludeCreditId") ?? undefined }), "procurement.view");
}
