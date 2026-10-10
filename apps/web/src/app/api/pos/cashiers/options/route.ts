import { getCashierOptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// Workspace members (and whether they already have a profile), outlets, employees, POS roles and the next cashier code.
export async function GET(request: Request) {
  return posRead(request, (client, context) => getCashierOptions(client, context), "pos.cashiers.view");
}
