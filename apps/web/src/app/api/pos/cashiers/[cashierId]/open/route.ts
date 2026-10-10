import { z } from "zod";

import { openPosForCashier } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ cashierId: string }> };

// "Open POS" for a cashier: { action: "resume" } for their open session, or { action: "open_session", outlets, preselected } with their
// outlets (default first) and the terminals free to open a session on.
export async function POST(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), (client, context) => openPosForCashier(client, context, cashierId), 200, "pos.view");
}
