import { listVarianceExceptions, openVarianceException } from "@vercentlabs/api";

import { openExceptionSchema } from "@/features/manufacturing/variance/api/variance-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Material variance exceptions (?status=open|OPEN|SUBMITTED|APPROVED|REJECTED|RESOLVED|all&reason=&orderId=&search=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "reason", "orderId", "search"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ exceptions: await listVarianceExceptions(client, context, filters) }));
}

// Open an investigation of one material line (an investigation already in progress is returned).
export async function POST(request: Request) {
  return manufacturingMutation(request, openExceptionSchema, async (client, context, input) => openVarianceException(client, context, input.manufacturingOrderId, input), 201);
}
