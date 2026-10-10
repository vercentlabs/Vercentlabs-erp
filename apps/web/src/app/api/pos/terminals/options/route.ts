import { getTerminalOptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// Outlets (with their warehouse and accepted payment methods), locations, cash accounts and payment methods.
export async function GET(request: Request) {
  return posRead(request, (client, context) => getTerminalOptions(client, context), "pos.terminals.view");
}
