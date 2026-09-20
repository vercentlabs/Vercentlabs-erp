import { z } from "zod";

import { runProcurementMatchWithVendorBillImport } from "@vercentlabs/api";

import { accountingContextForVendorBill } from "@/features/procurement/shared/cross-module-contexts";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";

const schema = z.object({
  purchaseOrderId: z.string().uuid(),
  supplierId: z.string().uuid().nullish(),
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.string().date().nullish(),
  currencyCode: z.string().trim().length(3).nullish(),
  matchMode: z.enum(["two_way", "three_way"]).nullish(),
  lines: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
}).passthrough();

// Supplier-invoice matching against the PO (2-way) and receipts (3-way). A clean
// match is handed to Accounting as a vendor bill when the supplier is linked to an
// Accounting party; otherwise the match stands and says why no bill was created.
export async function POST(request: Request) {
  return procurementMutation(request, schema, async (client, context, input, session) => {
    const order = await client.query("SELECT company_id FROM tenant.procurement_purchase_orders WHERE organization_id=$1 AND id=$2", [context.organizationId, input.purchaseOrderId]);
    const companyId = (order.rows[0]?.company_id as string | undefined) ?? context.activeCompanyId ?? "";
    return { result: await runProcurementMatchWithVendorBillImport(client, context, accountingContextForVendorBill(session, companyId), input) };
  }, 201);
}
