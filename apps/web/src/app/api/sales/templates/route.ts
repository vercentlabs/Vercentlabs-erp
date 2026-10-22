import { z } from "zod";

import { listMessageTemplates, saveMessageTemplate } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Setup › Print & WhatsApp templates (Sales plan): the message each document starts from. An empty body goes back to the built-in text.
export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => listMessageTemplates(client, context));
}

const schema = z.object({
  kind: z.enum(["quotation", "order_confirmation", "invoice", "credit_note", "debit_note", "receipt", "payment_reminder"]),
  channel: z.enum(["whatsapp", "email"]),
  body: z.string().max(2000).nullish(),
});

export async function PUT(request: Request) {
  return salesMutation(request, "sales.settings.manage", schema, async (client, context, input) => ({ template: await saveMessageTemplate(client, context, input) }));
}
