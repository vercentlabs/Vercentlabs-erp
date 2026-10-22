import { z } from "zod";

import { addCollectionNote, listCollectionNotes } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Reminders sent, promises to pay and notes about what the customer owes (Sales plan, Flow 4). Needs the customer financials permission.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => listCollectionNotes(client, context, id));
}

const schema = z.object({
  kind: z.enum(["promise", "note", "reminder"]),
  channel: z.enum(["whatsapp", "email", "call", "visit"]).nullish(),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  promisedAmount: z.number().positive().nullish(),
  note: z.string().max(1000).nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", schema, async (client, context, input) => addCollectionNote(client, context, id, input), 201);
}
