import { updateSupplierBankAccount } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string; accountId: string }> };

// Body: account fields, isPrimary, status ("active" | "inactive"). Every change is recorded in the supplier's history, masked.
export async function PATCH(request: Request, ctx: Params) {
  const { id, accountId } = await ctx.params;
  return accountingMutation(request, bodySchema, async (client, context, input) => await updateSupplierBankAccount(client, context, id, accountId, input), 200,
    "accounting.supplier_payment_details.manage");
}
