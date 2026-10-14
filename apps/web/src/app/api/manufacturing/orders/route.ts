import { z } from "zod";

import { createManufacturingOrder, listManufacturingOrders } from "@vercentlabs/api";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";
import { orderHeaderSchema } from "@/features/manufacturing/orders/api/mo-schemas";

// Manufacturing orders (?status=&search=&itemId=&priority=&from=&to=&parentOrderId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "search", "itemId", "priority", "from", "to", "parentOrderId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ orders: await listManufacturingOrders(client, context, filters) }));
}

// A draft order; the same idempotency key returns the order it created.
const schema = orderHeaderSchema.extend({ idempotencyKey: z.string().trim().min(1).max(200).optional(), parentOrderId: z.string().uuid().optional() });

export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => ({ order: await createManufacturingOrder(client, context, input) }), 201);
}
