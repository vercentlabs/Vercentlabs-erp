import { z } from "zod";

import { clearCheques, depositCheques } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Many cheques at once: deposited in the bank, or cleared by it. Each cheque is reported on its own.
const schema = z.object({
  action: z.enum(["deposit", "clear"]),
  chequeIds: z.array(z.string().uuid()).min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.view", schema, async (client, context, input) => (input.action === "deposit"
    ? depositCheques(client, context, { chequeIds: input.chequeIds, depositedOn: input.date })
    : clearCheques(client, context, { chequeIds: input.chequeIds, clearedOn: input.date })));
}
