import { z } from "zod";

import { getPaymentGateway, savePaymentGateway } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// The company's own Razorpay account for Pay now on invoice links (Sales report Phase 3). Secrets are write-only.
const schema = z.object({
  keyId: z.string().trim().min(1).max(60), keySecret: z.string().trim().max(200).optional(), webhookSecret: z.string().trim().max(200).optional(),
  bankAccountId: z.string().uuid().nullish(), active: z.boolean().optional(),
});

export async function GET(request: Request) {
  return salesRead(request, "sales.settings.manage", async (client, context) => getPaymentGateway(client, context));
}

export async function PUT(request: Request) {
  return salesMutation(request, "sales.settings.manage", schema, async (client, context, input) => savePaymentGateway(client, context, input));
}
