import { z } from "zod";

import { procurementRecordCompanyId, runProcurementMatchWithVendorBillImport } from "@vercentlabs/api";

import { accountingContextForVendorBill } from "@/features/procurement/shared/cross-module-contexts";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";

const schema = z.object({
  purchaseOrderId: z.string().uuid(),
  supplierId: z.string().uuid().nullish(),
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.string().date().nullish(),
  currencyCode: z.string().trim().length(3).nullish(),
  matchMode: z.enum(["two-way", "three-way", "four-way"]).nullish(),
  tolerancePercent: z.number().min(0).max(100).nullish(),
  overrideReason: z.string().trim().max(1000).nullish(),
  invoiceLines: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
}).passthrough();

// Supplier-invoice matching against the PO (2-way) and receipts (3-way). A clean
// match is handed to Accounting as a vendor bill when the supplier is linked to an
// Accounting party; otherwise the match stands and says why no bill was created.
export async function POST(request: Request) {
  return procurementMutation(request, schema, async (client, context, input, session) => {
    const companyId = (await procurementRecordCompanyId(client, context.organizationId, "purchase-orders", input.purchaseOrderId)) ?? context.activeCompanyId ?? "";
    return { result: await runProcurementMatchWithVendorBillImport(client, context, accountingContextForVendorBill(session, companyId), input) };
  }, 201);
}
