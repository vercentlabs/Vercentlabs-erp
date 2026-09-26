import { z } from "zod";

import { listPosDiscountApprovals } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const querySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "all"]).optional(),
});

// F279-APP-001 -- the POS discount-approval queue. Read-only: deciding a
// request still goes through the platform's own POST /api/approvals/:id/
// decide (maker-checker + self-approval blocking live there); this route
// only makes the pending requests discoverable to the people who hold
// pos.discount.approve, which the generic approvals inbox never did.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const { status } = querySchema.parse({ status: url.searchParams.get("status") ?? undefined });
    const rows = await listPosDiscountApprovals(client, posContext(session), { status });
    return ok({ rows });
  });
}
