import { z } from "zod";

import { setTerminalStatus, validateTerminalForDeactivation, validateTerminalSetup } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ terminalId: string }> };

// What is missing before activation (setup) and what stands between the terminal and Inactive (blockers).
export async function GET(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posRead(request, async (client, context) => ({
    setup: await validateTerminalSetup(client, context, terminalId),
    blockers: await validateTerminalForDeactivation(client, context, terminalId),
  }), "pos.terminals.view");
}

// body: { status: active | inactive, reason? }
export async function POST(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posMutation(request, z.object({ status: z.string(), reason: z.string().optional() }),
    async (client, context, input) => ({ terminal: await setTerminalStatus(client, context, terminalId, input.status, input) }), 200, "pos.terminals.view");
}
