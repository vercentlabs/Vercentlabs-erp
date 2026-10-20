import { createSupportTicket, listSupportTickets } from "@vercentlabs/api";
import { z } from "zod";

import { supportMutation, supportRead } from "@/features/support/shared/route-helpers";

// Support — tickets: the queues (view, search, priority, agent, customer, dates) and creating a ticket by hand.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return supportRead(request, async (client, context) => ({
    rows: await listSupportTickets(client, context, { view: get("view"), search: get("search"), priority: get("priority"), agentId: get("agentId"), customerId: get("customerId"), from: get("from"), to: get("to") }),
  }));
}
export async function POST(request: Request) {
  return supportMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createSupportTicket(client, context, input), 201);
}
