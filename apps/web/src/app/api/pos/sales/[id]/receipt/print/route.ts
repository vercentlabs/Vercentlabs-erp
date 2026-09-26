import { recordPosReceiptPrintAttempt } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// F289 gap closure: durable evidence that a receipt print was requested,
// replacing the frontend's previous client-supplied `?original=1` URL
// parameter (trivially forgeable, proved nothing). See
// services/api/src/modules/point-of-sale/transaction-continuity-and-documents/receipts.js
// for exactly what this can and cannot claim.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.view", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const result = await recordPosReceiptPrintAttempt(client, posContext(session), id);
    return ok({ printEvent: result }, 201);
  });
}
