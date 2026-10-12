import { getTerminalHandover } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ terminalId: string }> };

// GET: the cash handed over at this counter's last close and not yet received (amounts only for those who may see expected cash), or null.
export async function GET(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posRead(request, async (client, context) => ({ handover: await getTerminalHandover(client, context, terminalId) }), "pos.view");
}
