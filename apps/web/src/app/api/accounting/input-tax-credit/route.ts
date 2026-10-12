import { z } from "zod";

import { decideInputTaxCredit, listInputTaxCredit, undoInputTaxCreditDecision } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Input GST by document, and whether its credit is awaiting confirmation, claimable or not claimable.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["status"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ itc: await listInputTaxCredit(client, context, filters) }));
}

// Confirms or refuses the credit on one document (or undoes that decision).
const schema = z.object({
  action: z.enum(["decide", "undo"]).default("decide"),
  sourceType: z.enum(["vendor_bill", "vendor_credit_note", "expense"]),
  sourceId: z.string().uuid(),
  decision: z.enum(["ELIGIBLE", "INELIGIBLE"]).optional(),
  reason: z.string().trim().min(1).max(500),
  reference: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({
    result: input.action === "undo" ? await undoInputTaxCreditDecision(client, context, input) : await decideInputTaxCredit(client, context, input),
  }), 200, "accounting.tax.manage");
}
