import { getSupportTicket } from "@vercentlabs/api";

import { supportRead } from "@/features/support/shared/route-helpers";

// One ticket: its conversation (private notes only for staff), files, deadlines, history and what the person may do.
type Params = { params: Promise<{ ticketId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { ticketId } = await ctx.params;
  return supportRead(request, (client, context) => getSupportTicket(client, context, ticketId));
}
