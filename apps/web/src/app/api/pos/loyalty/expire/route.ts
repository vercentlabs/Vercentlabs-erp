import { expirePosLoyaltyPoints } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// F306 -- run the points-expiry pass for the caller's company against its
// program's points_expiry_days. Deliberately takes no body: the cutoff is
// always derived server-side from "now" and the program, never client-
// supplied, so a caller cannot expire points early by sending a made-up date.
// Safe to call repeatedly -- see expirePosLoyaltyPoints's idempotency note.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.loyalty.manage", billingWrite: true }, async ({ client, session }) => {
    const result = await expirePosLoyaltyPoints(client, posContext(session));
    return ok({ result });
  });
}
