import { createScrapDraft, listManufacturingScraps } from "@vercentlabs/api";

import { scrapDraftSchema } from "@/features/manufacturing/scrap/api/scrap-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Scrap notes (?status=&type=&disposition=&lossClass=&reason=&correction=&orderId=&itemId=&from=&to=&search=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "type", "disposition", "lossClass", "reason", "correction", "orderId", "itemId", "from", "to", "search"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ scraps: await listManufacturingScraps(client, context, filters) }));
}

// A draft scrap note (nothing moves); the same idempotency key returns the draft it created.
export async function POST(request: Request) {
  return manufacturingMutation(request, scrapDraftSchema, async (client, context, input) => ({ scrap: await createScrapDraft(client, context, input) }), 201);
}
