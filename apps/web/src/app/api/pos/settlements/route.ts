import { z } from "zod";

import { assertSameOriginOrMobile, importPosSettlementBatch } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const importSchema = z.object({
  storeId: z.string().uuid().optional().nullable(),
  paymentMethod: z.enum(["card", "upi", "bank_transfer", "wallet", "store_credit"]),
  providerKey: z.string().trim().min(1).max(100),
  batchReference: z.string().trim().min(1).max(200),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z
    .array(
      z.object({
        providerReference: z.string().trim().min(1).max(200),
        amount: z.number().positive(),
        feeAmount: z.number().min(0).optional(),
        settledAt: z.string().optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = importSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.reconciliation.manage");
      return importPosSettlementBatch(client, posContext(session), input);
    });
    return ok(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
