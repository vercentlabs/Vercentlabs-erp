import { z } from "zod";

import { listPosCashDrawers, savePosCashDrawer } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// GET ?storeId=: an outlet's cash drawers, the counters using each, and who holds it now.
export async function GET(request: Request) {
  const storeId = new URL(request.url).searchParams.get("storeId");
  return posRead(request, async (client, context) => ({ drawers: await listPosCashDrawers(client, context, { storeId }) }), "pos.view");
}

// POST: add or change a drawer (those who configure terminal cash).
const schema = z.object({ id: z.string().uuid().optional(), storeId: z.string().uuid().optional(), code: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(120),
  status: z.enum(["active", "inactive"]).optional() });

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ drawer: await savePosCashDrawer(client, context, input) }), 200, "pos.view");
}
