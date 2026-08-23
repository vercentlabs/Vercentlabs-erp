import { diagnoseStockBalanceDrift } from "@vercentlabs/api";

import { errorResponse, ok } from "@/core/http";
import { stockSession, tenantTransaction } from "@/modules/stock/server";

// GET: dry-run diagnosis only, never mutates. POST: explicit, opt-in repair
// (requires stock.adjust, enforced inside diagnoseStockBalanceDrift itself)
// — matches Part B22's "explicit admin/script operation, not automatic
// hidden mutation" requirement. Reuses the exact same tenant-scoped,
// session-authenticated connection every other Stock route uses, so this
// can never be pointed at an arbitrary database — see
// docs/implementation/ERP_P0_INTEGRITY_FIXES_012.md Section 13.
export async function GET() {
  try {
    const { context } = await stockSession(false);
    const result = await tenantTransaction(context.organizationId, (c) =>
      diagnoseStockBalanceDrift(c, context, { repair: false }),
    );
    return ok(result);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST() {
  try {
    const { context } = await stockSession(true);
    const result = await tenantTransaction(context.organizationId, (c) =>
      diagnoseStockBalanceDrift(c, context, { repair: true }),
    );
    return ok(result);
  } catch (e) {
    return errorResponse(e);
  }
}
