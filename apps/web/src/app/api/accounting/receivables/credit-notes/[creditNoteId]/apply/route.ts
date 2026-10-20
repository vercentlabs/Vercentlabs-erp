import { z } from "zod";

import { applyCustomerCreditNote } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ creditNoteId: string }> };
const schema = z.object({ allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.string().regex(/^\d{1,15}(\.\d{1,6})?$/) })).min(1).max(200) });

// A credit note settles the customer's open invoices (never more than each owes, never more than the credit has left).
export async function POST(request: Request, { params }: Params) {
  const { creditNoteId } = await params;
  return accountingMutation(request, schema, async (client, context, input) => ({ result: await applyCustomerCreditNote(client, context, creditNoteId, input) }));
}
