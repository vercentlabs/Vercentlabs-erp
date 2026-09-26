import { z } from "zod";

import { importPosSettlementBatch } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

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
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.reconciliation.manage" }, async ({ client, session }) => {
    const input = importSchema.parse(await readJson(request));
    const result = await importPosSettlementBatch(client, posContext(session), input);
    return ok(result, 201);
  });
}
