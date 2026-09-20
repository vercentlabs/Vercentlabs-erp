import { assertSameOriginOrMobile, expirePosLoyaltyPoints } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// F306 -- run the points-expiry pass for the caller's company against its
// program's points_expiry_days. Deliberately takes no body: the cutoff is
// always derived server-side from "now" and the program, never client-
// supplied, so a caller cannot expire points early by sending a made-up date.
// Safe to call repeatedly -- see expirePosLoyaltyPoints's idempotency note.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.loyalty.manage", { mutation: true });
      return expirePosLoyaltyPoints(client, posContext(session));
    });
    return ok({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
