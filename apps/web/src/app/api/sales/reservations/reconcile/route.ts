import { z } from "zod";

import { reconcileSalesReservations } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// GET: are the reservations consistent (Inventory's cached reserved quantities, and each line's reservation against what it still needs)?
export async function GET(request: Request) {
  return salesRead(request, "sales.reservation.view_all", async (client, context) => ({ reconciliation: await reconcileSalesReservations(client, context, {}) }));
}

// POST { repair: true }: rebuild the cache and release what is held beyond demand (needs the permission to adjust stock for the cache).
const schema = z.object({ repair: z.boolean().optional() });
export async function POST(request: Request) {
  return salesMutation(request, "sales.reservation.view_all", schema, async (client, context, input) => ({ reconciliation: await reconcileSalesReservations(client, context, { repair: Boolean(input.repair) }) }));
}
