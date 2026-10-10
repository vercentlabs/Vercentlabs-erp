import { z } from "zod";

import { openPosForTerminal } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ terminalId: string }> };

// "Open POS" on a terminal: { action: "resume" } for the caller's own open session, { action: "open_session" } when a session must be opened
// first; refused when the terminal, its outlet or the caller's access does not allow it, or someone else's session is open on it.
export async function POST(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), (client, context) => openPosForTerminal(client, context, terminalId), 200, "pos.view");
}
