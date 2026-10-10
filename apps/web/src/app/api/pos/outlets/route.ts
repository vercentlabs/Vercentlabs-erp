import { z } from "zod";

import { createOutlet, listOutlets } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

const FILTERS = ["view", "search", "status", "state", "city", "warehouseId", "managerUserId"] as const;

// ?view=all|active|inactive|mine, ?search=, ?state=, ?city=, ?warehouseId=, ?managerUserId=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return posRead(request, (client, context) => listOutlets(client, context, filters));
}

// Saved Inactive; activated once its setup is complete.
export async function POST(request: Request) {
  return posMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ outlet: await createOutlet(client, context, input) }), 201);
}
