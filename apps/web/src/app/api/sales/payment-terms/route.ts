import { z } from "zod";

import { createPaymentTerm, listPaymentTerms } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// The Payment Terms master: every term, active or not, with where it is used.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["status", "search", "usage"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return salesRead(request, "payment_terms.view", async (client, context) => await listPaymentTerms(client, context, filters));
}

const schema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  calculationType: z.enum(["due_on_receipt", "net_days", "custom"]),
  days: z.union([z.number(), z.string()]).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  salesEnabled: z.boolean().optional(),
  purchaseEnabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  return salesMutation(request, "payment_terms.manage", schema, async (client, context, input) => ({ term: await createPaymentTerm(client, context, input) }), 201);
}
