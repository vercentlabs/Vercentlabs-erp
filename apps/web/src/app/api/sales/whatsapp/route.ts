import { z } from "zod";

import { sendDocumentOnWhatsApp } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Sends a Sales document on WhatsApp (Sales audit M6): returns the message and the wa.me link, and records the document as sent on
// WhatsApp. Each document's own "send" permission is checked by the operation.
const schema = z.object({
  kind: z.enum(["quotation", "proforma", "order", "invoice", "credit_note", "debit_note", "receipt", "reminder"]),
  id: z.string().uuid(),
  phone: z.string().max(30).optional(),
  body: z.string().max(4000).optional(),
  idempotencyKey: z.string().max(180).optional(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.view", schema, async (client, context, input) => ({ result: await sendDocumentOnWhatsApp(client, context, input) }));
}
