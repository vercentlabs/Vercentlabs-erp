import { z } from "zod";

import { procurementRecordCompanyId, transitionProcurementReceiptWithStockMovement, transitionProcurementRecord, transitionProcurementReturnWithStockMovement } from "@vercentlabs/api";

import { stockContextForReceiving } from "@/features/procurement/shared/cross-module-contexts";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";

const schema = z.record(z.string(), z.unknown());

// Lifecycle actions (submit, approve, reject, dispatch, close, cancel, award,
// amend, ...). The domain owns the state machine, the per-action permission,
// optimistic-concurrency (expectedVersion) and self-approval blocking. Approving
// or reversing a goods receipt, or dispatching a return, additionally posts the real
// Stock movement in the same transaction through the orchestration.
export async function POST(request: Request, ctx: { params: Promise<{ resource: string; id: string; action: string }> }) {
  const { resource, id, action } = await ctx.params;
  return procurementMutation(request, schema, async (client, context, input, session) => {
    if (resource === "receipts" && (action === "approve" || action === "reverse")) {
      const companyId = await procurementRecordCompanyId(client, context.organizationId, "receipts", id);
      if (companyId) return { record: await transitionProcurementReceiptWithStockMovement(client, context, stockContextForReceiving(session, companyId), id, action, input) };
    }
    if (resource === "returns" && action === "dispatch") {
      const companyId = await procurementRecordCompanyId(client, context.organizationId, "returns", id);
      if (companyId) return { record: await transitionProcurementReturnWithStockMovement(client, context, stockContextForReceiving(session, companyId), id, action, input) };
    }
    return { record: await transitionProcurementRecord(client, context, resource, id, action, input) };
  });
}
