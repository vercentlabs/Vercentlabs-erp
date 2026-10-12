import { z } from "zod";

import { listInvoiceSeries, saveInvoiceSeries } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// GET: invoice numbering series per GST registration and financial year, and each registration's e-invoice setting.
export async function GET(request: Request) {
  return posRead(request, async (client, context) => listInvoiceSeries(client, context), "pos.view");
}

// POST: set up (or close) a series before it is used. A series that has issued numbers keeps its format. Administrators only.
const schema = z.object({
  registrationId: z.string().uuid(),
  kind: z.enum(["tax_invoice", "bill_of_supply", "credit_note", "debit_note"]),
  financialYear: z.string().regex(/^[0-9]{4}-[0-9]{2}$/).optional(),
  prefix: z.string().trim().min(1).max(8).optional(),
  padding: z.number().int().min(3).max(8).optional(),
  status: z.enum(["active", "closed"]).optional(),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ series: await saveInvoiceSeries(client, context, input) }), 200, "pos.settings.manage");
}
