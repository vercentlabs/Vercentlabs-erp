import { z } from "zod";

import { listPosDiscountApprovals } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const querySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "all"]).optional(),
});

// F279-APP-001 -- the POS discount-approval queue. Read-only: deciding a
// request still goes through the platform's own POST /api/approvals/:id/
// decide (maker-checker + self-approval blocking live there); this route
// only makes the pending requests discoverable to the people who hold
// pos.discount.approve, which the generic approvals inbox never did.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const { status } = querySchema.parse({ status: url.searchParams.get("status") ?? undefined });
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPosDiscountApprovals(client, posContext(session), { status });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
