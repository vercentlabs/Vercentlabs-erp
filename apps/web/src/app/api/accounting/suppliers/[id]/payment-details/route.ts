import { addSupplierBankAccount, listSupplierPaymentDetails } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

type Params = { params: Promise<{ id: string }> };

// Where a supplier is paid. Finance's: seen with accounting.supplier_payment_details.view, changed with .manage.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return accountingRead(request, async (client, context) => await listSupplierPaymentDetails(client, context, id), "accounting.supplier_payment_details.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return accountingMutation(request, bodySchema, async (client, context, input) => await addSupplierBankAccount(client, context, id, input), 201,
    "accounting.supplier_payment_details.manage");
}
