import { z } from "zod";

import { assignTerminalCashDrawer } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ terminalId: string }> };

// POST: which cash drawer this counter uses (not while a shift is open on it).
const schema = z.object({ drawerId: z.string().uuid() });

export async function POST(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ assignment: await assignTerminalCashDrawer(client, context, terminalId, input.drawerId) }), 200, "pos.view");
}
