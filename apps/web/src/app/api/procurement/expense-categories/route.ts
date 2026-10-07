import { listExpenseCategories, saveExpenseCategory } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Expense categories: plain-language names for direct bill lines, each posting to its Finance account. Body: { id?, code, name, accountId, defaultTaxCategoryId?, defaultHsnSac?, status? }.
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ categories: await listExpenseCategories(client, context, { includeInactive: true }) }), "procurement.bills.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ category: await saveExpenseCategory(client, context, (input as { id?: string }).id ?? null, input) }), 200,
    "procurement.bills.categories");
}
