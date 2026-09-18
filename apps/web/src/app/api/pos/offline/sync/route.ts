import { z } from "zod";

import { assertSameOriginOrMobile, syncOfflinePosSale } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// Shape-level validation only. Every price/tax/stock/discount/shift figure
// is re-derived fresh, from current Postgres state, inside
// syncOfflinePosSale -> completePointOfSale (services/api/src/modules/
// point-of-sale/index.js) -- capturedUnitPrice below is compared for
// price-drift detection, never trusted as the figure to charge.
const lineSchema = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  quantity: z.number().positive(),
  capturedUnitPrice: z.number().min(0),
  discountAmount: z.number().min(0).optional().nullable(),
  discountReason: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  warehouseLocationId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  serialId: z.string().uuid().optional().nullable(),
});

// Only cash is ever accepted for an offline sale (OFFLINE_UNSUPPORTED_
// OPERATIONS: NON_CASH_TENDER) -- the enum below intentionally has just
// one member so a non-cash tender fails Zod validation before it ever
// reaches syncOfflinePosSale's own (defense-in-depth) cash-only check.
const paymentSchema = z.object({ method: z.literal("cash"), amount: z.number().positive() });

const transactionSchema = z.object({
  localTransactionId: z.string().uuid(),
  storeId: z.string().uuid(),
  terminalId: z.string().uuid().optional().nullable(),
  shiftId: z.string().uuid(),
  lines: z.array(lineSchema).min(1),
  payments: z.array(paymentSchema).min(1),
  customerName: z.string().trim().max(200).optional().nullable(),
  roundingAdjustment: z.number().gt(-1).lt(1).optional(),
  capturedAt: z.string().optional().nullable(),
});

const syncSchema = z.object({
  transactions: z.array(transactionSchema).min(1).max(50),
});

// Each queued offline transaction is synced in its OWN database
// transaction -- a price/stock/shift conflict on one queued sale must
// never roll back or block the others in the same batch, and each one
// gets its own idempotency reservation keyed on its own local transaction
// id (see syncOfflinePosSale).
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = syncSchema.parse(await readJson(request));

    const results = [];
    for (const transaction of input.transactions) {
      try {
        const result = await tenantTransaction(session.organizationId, async (client) => {
          await requirePosAccess(client, session, "pos.offline.sync");
          return syncOfflinePosSale(client, posContext(session), transaction);
        });
        results.push(result);
      } catch (error) {
        const status = (error as { status?: number })?.status;
        const code = (error as { code?: string })?.code;
        const message = error instanceof Error ? error.message : "The offline sale could not be synced.";
        results.push({
          outcome: "error",
          localTransactionId: transaction.localTransactionId,
          status: status || 500,
          code: code || "POS_OFFLINE_SYNC_FAILED",
          detail: message,
        });
      }
    }
    return ok({ results });
  } catch (error) {
    return errorResponse(error);
  }
}
