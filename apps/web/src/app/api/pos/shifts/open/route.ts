import { z } from "zod";

import { openShift, recordShiftOpeningAttempt } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: open your shift at a counter — the operating session and, for a cash counter, its cash session with the counted, confirmed float (any
// handover waiting is received and compared). Idempotent: a retry, a double click or a refresh returns the same shift. A refusal is recorded
// (who, which counter, the sanitized reason) in its own transaction, since the request's is rolled back.
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const schema = z.object({
  terminalId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  cashEnabled: z.boolean().optional(),
  cashDrawerId: z.string().uuid().optional(),
  sourceType: z.enum(["FRESH_FLOAT", "HANDOVER", "EXISTING_DRAWER", "ZERO_FLOAT"]).optional(),
  sourceReference: z.string().trim().max(200).optional(),
  handoverId: z.string().uuid().optional(),
  openingCash: z.string().trim().regex(MONEY).optional(),
  denominations: z.array(z.object({ denomination: z.number().positive(), count: z.number().int().min(0) })).max(30).optional(),
  openingCashConfirmed: z.boolean().optional(),
  varianceReason: z.string().trim().max(500).optional(),
  approvalId: z.string().uuid().optional().nullable(),
  expectedTerminalVersion: z.number().int().optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => {
    try {
      return { shift: await openShift(client, context, input) };
    } catch (error) {
      const code = (error as { code?: string }).code ?? "POS_SHIFT_OPENING_FAILED";
      await tenantTransaction(context.organizationId, (tx) => recordShiftOpeningAttempt(tx, context, {
        terminalId: input.terminalId, outcome: code.startsWith("POS_SHIFT_") ? "denied" : "failed", code, message: (error as Error).message,
      })).catch(() => undefined);
      throw error;
    }
  }, 201, "pos.view");
}
