import { z } from "zod";

import { createCashier, listCashiers } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

const FILTERS = ["view", "search", "status", "outletId", "role"] as const;

// ?view=all|active|inactive|on_shift, ?search=, ?outletId=, ?role= (POS role name)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return posRead(request, (client, context) => listCashiers(client, context, filters), "pos.cashiers.view");
}

// body: { userId, code?, displayName?, employeeId?, outletIds, defaultOutletId?, notes?, activate? }. Saved inactive unless activated.
export async function POST(request: Request) {
  return posMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ cashier: await createCashier(client, context, input) }), 201,
    "pos.cashiers.view");
}
