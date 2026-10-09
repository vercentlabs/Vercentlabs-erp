import { z } from "zod";

import { createWarehouse, listWarehouses } from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

const FILTERS = ["view", "search", "status", "state", "city", "managerUserId", "receiving", "shipping"] as const;

// ?view=all|active|inactive|mine, ?search=, ?state=, ?city=, ?managerUserId=, ?receiving=yes|no, ?shipping=yes|no
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listWarehouses(client, context, filters), WAREHOUSE_PERMISSIONS.view);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) =>
    ({ warehouse: await createWarehouse(client, context, input) }), 201, WAREHOUSE_PERMISSIONS.view);
}
