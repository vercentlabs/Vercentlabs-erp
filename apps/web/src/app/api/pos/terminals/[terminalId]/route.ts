import { z } from "zod";

import { deleteTerminal, getTerminal, updateTerminal } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ terminalId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posRead(request, async (client, context) => ({ terminal: await getTerminal(client, context, terminalId) }), "pos.terminals.view");
}

// Any terminal field, expectedVersion, reason. Posting-critical settings wait for an open session to close.
export async function PATCH(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ terminal: await updateTerminal(client, context, terminalId, input) }), 200,
    "pos.terminals.view");
}

// Only a terminal nothing has used; anything else is deactivated.
export async function DELETE(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), (client, context) => deleteTerminal(client, context, terminalId), 200, "pos.terminals.view");
}
