import {
  addSupportNote, assignSupportTicket, cancelSupportTicket, closeSupportTicket, linkSupportTicketCustomer, logSupportCustomerMessage, reopenSupportTicket, replyToSupportCustomer,
  resolveSupportTicket, retrySupportReply, setSupportTicketStatus, updateSupportTicket,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { supportMutation } from "@/features/support/shared/route-helpers";

// POST update · assign · status · reply · retry-reply · note · log-customer · resolve · close · reopen · cancel · link-customer. Each domain
// function enforces its own permission, state and row version.
type Params = { params: Promise<{ ticketId: string; action: string }> };
const STEPS = {
  update: updateSupportTicket, assign: assignSupportTicket, status: setSupportTicketStatus, reply: replyToSupportCustomer, "retry-reply": retrySupportReply, note: addSupportNote,
  "log-customer": logSupportCustomerMessage, resolve: resolveSupportTicket, close: closeSupportTicket, reopen: reopenSupportTicket, cancel: cancelSupportTicket,
  "link-customer": linkSupportTicketCustomer,
} as const;
export async function POST(request: Request, ctx: Params) {
  const { ticketId, action } = await ctx.params;
  const step = STEPS[action as keyof typeof STEPS];
  if (!step) throw new HttpError(404, "Unknown action.", "NOT_FOUND");
  return supportMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => step(client, context, ticketId, input));
}
