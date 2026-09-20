import { z } from "zod";

import { transitionProcurementReceiptWithStockMovement, transitionProcurementRecord } from "@vercentlabs/api";

import { stockContextForReceiving } from "@/features/procurement/shared/cross-module-contexts";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";

const schema = z.record(z.string(), z.unknown());

// Lifecycle actions (submit, approve, reject, dispatch, close, cancel, award,
// amend, ...). The domain owns the state machine, the per-action permission,
// optimistic-concurrency (expectedVersion) and self-approval blocking. Approving
// or reversing a goods receipt additionally posts the real Stock movement, in the
// same transaction, through the orchestration.
export async function POST(request: Request, ctx: { params: Promise<{ resource: string; id: string; action: string }> }) {
  const { resource, id, action } = await ctx.params;
  return procurementMutation(request, schema, async (client, context, input, session) => {
    if (resource === "receipts" && (action === "approve" || action === "reverse")) {
      const receipt = await client.query("SELECT company_id FROM tenant.procurement_receipts WHERE organization_id=$1 AND id=$2", [context.organizationId, id]);
      const companyId = receipt.rows[0]?.company_id as string | undefined;
      if (companyId) return { record: await transitionProcurementReceiptWithStockMovement(client, context, stockContextForReceiving(session, companyId), id, action, input) };
    }
    return { record: await transitionProcurementRecord(client, context, resource, id, action, input) };
  });
}
