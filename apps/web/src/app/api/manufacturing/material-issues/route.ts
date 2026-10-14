import { createMaterialIssueDraft, listMaterialIssues } from "@vercentlabs/api";

import { issueDraftSchema } from "@/features/manufacturing/issues/api/mi-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Material issue notes (?status=&orderId=&warehouseId=&itemId=&issuedBy=&batchId=&from=&to=&search=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "orderId", "warehouseId", "itemId", "issuedBy", "batchId", "from", "to", "search"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ issues: await listMaterialIssues(client, context, filters) }));
}

// A draft note (nothing moves); the same idempotency key returns the draft it created.
export async function POST(request: Request) {
  return manufacturingMutation(request, issueDraftSchema, async (client, context, input) => ({ issue: await createMaterialIssueDraft(client, context, input) }), 201);
}
