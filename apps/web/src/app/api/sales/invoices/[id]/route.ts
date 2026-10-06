import { z } from "zod";

import { getSalesInvoice, updateDraftInvoice } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.invoice.view", async (client, context) => ({ invoice: await getSalesInvoice(client, context, id) }));
}

// A draft's quantities, dates, payment terms, due date, contact and notes, or its tax worked out again on the invoice date.
const schema = z.object({
  expectedVersion: z.number().int().optional(),
  lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]) })).max(500).optional(),
  invoiceDate: z.string().date().optional(),
  postingDate: z.string().date().optional(),
  paymentTermId: z.string().uuid().optional(),
  paymentTermsNote: z.string().max(1000).nullable().optional(),
  // A date sets the due date by hand (with a reason when the terms work one out); null goes back to what the terms work out.
  dueDate: z.string().date().nullable().optional(),
  dueDateReason: z.string().max(500).nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  customerNotes: z.string().max(4000).nullable().optional(),
  internalNotes: z.string().max(4000).nullable().optional(),
  recalculateTax: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  // The module decides who may change what: the terms and due date need their own permissions, the rest the right to edit.
  return salesMutation(request, "sales.invoice.view", schema, async (client, context, input) => ({ result: await updateDraftInvoice(client, context, id, input) }));
}
