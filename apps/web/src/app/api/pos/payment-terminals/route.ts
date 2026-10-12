import { z } from "zod";

import { listPosPaymentTerminals, savePosPaymentTerminal } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// GET ?storeId=: the card devices of the outlets you work at, and whether each is free.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    terminals: await listPosPaymentTerminals(client, context, { storeId: url.searchParams.get("storeId") ?? undefined }),
  }), "pos.view");
}

// POST: register or change a card device (administrators only). Card data is never sent here: only the provider's device reference.
const schema = z.object({
  id: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  providerKey: z.string().trim().max(40).optional(),
  providerTerminalReference: z.string().trim().min(1).max(80),
  merchantAccountReference: z.string().trim().max(80).nullish(),
  integrationMode: z.enum(["integrated", "standalone"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ terminal: await savePosPaymentTerminal(client, context, input) }), 200, "pos.settings.manage");
}
