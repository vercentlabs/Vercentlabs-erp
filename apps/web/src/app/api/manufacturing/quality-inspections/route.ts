import { createInspectionDraft, listQualityInspections } from "@vercentlabs/api";

import { inspectionDraftSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Production inspections (?status=&stage=&orderId=&entryId=&itemId=&outcome=&from=&to=&search=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "stage", "orderId", "entryId", "itemId", "outcome", "from", "to", "search"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ inspections: await listQualityInspections(client, context, filters) }));
}

// A draft inspection over output awaiting inspection (nothing is decided); the same idempotency key returns the draft it created.
export async function POST(request: Request) {
  return manufacturingMutation(request, inspectionDraftSchema, async (client, context, input) => ({ inspection: await createInspectionDraft(client, context, input) }), 201);
}
