import { createCreditFromAcceptedClaim, createCreditFromPurchaseReturn, createCreditFromSupplierBill, createVendorCredit, listDebitNotesAndCredits } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Debit Notes & Vendor Credits: the list (claims and credits, by view) and a new vendor credit — from a bill, a posted return, an accepted
// claim (fromBillId / fromReturnId / fromClaimId) or entered line by line. Each operation checks its own permission.
const FILTERS = ["view", "supplierId", "status", "settlementStatus", "origin", "from", "to", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => listDebitNotesAndCredits(client, context, filters), "procurement.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    const body = input as Record<string, unknown>;
    const { fromBillId, fromReturnId, fromClaimId, ...rest } = body;
    const result = typeof fromClaimId === "string" ? await createCreditFromAcceptedClaim(client, context, fromClaimId, rest)
      : typeof fromReturnId === "string" ? await createCreditFromPurchaseReturn(client, context, fromReturnId, rest)
        : typeof fromBillId === "string" ? await createCreditFromSupplierBill(client, context, fromBillId, rest)
          : await createVendorCredit(client, context, rest);
    return { result };
  }, 201, "procurement.view");
}
