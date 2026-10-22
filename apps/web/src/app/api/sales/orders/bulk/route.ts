import { z } from "zod";

import { createDeliveriesForOrders, createInvoicesForOrders } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Many orders at once (Sales plan, Flows 2 and 3): their deliveries (one per order and warehouse) or invoices. Each order is its own step:
// one that cannot be done is reported, the others are made. Each operation checks its own permission.
const schema = z.object({
  action: z.enum(["deliveries", "invoices"]),
  orderIds: z.array(z.string().uuid()).min(1).max(100),
  idempotencyKey: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.view", schema, async (client, context, input) =>
    input.action === "deliveries" ? createDeliveriesForOrders(client, context, input) : createInvoicesForOrders(client, context, input));
}
