import { assertSameOriginOrMobile, recordPosReceiptPrintAttempt } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// F289 gap closure: durable evidence that a receipt print was requested,
// replacing the frontend's previous client-supplied `?original=1` URL
// parameter (trivially forgeable, proved nothing). See
// services/api/src/modules/point-of-sale/transaction-continuity-and-documents/receipts.js
// for exactly what this can and cannot claim.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.view", { mutation: true });
      return recordPosReceiptPrintAttempt(client, posContext(session), id);
    });
    return ok({ printEvent: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
