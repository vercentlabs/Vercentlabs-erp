import { z } from "zod";

import { applyAdvanceToInvoice, listInvoiceAdvances } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// The customer's advances that can pay this invoice (Sales plan, Flow 4), and applying them (oldest first, or the one chosen).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.invoice.view", async (client, context) => listInvoiceAdvances(client, context, id));
}

const schema = z.object({ receiptId: z.string().uuid().optional(), amount: z.number().positive().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.view", schema, async (client, context, input) => ({ result: await applyAdvanceToInvoice(client, context, id, input) }));
}
