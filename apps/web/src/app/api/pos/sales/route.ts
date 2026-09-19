import { z } from "zod";

import { assertSameOriginOrMobile, completePointOfSale, listPointOfSaleResource } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// Shape-level validation only — the authoritative business rules (stock
// availability, price-list resolution, discount/override permission,
// payment-method gating, underpayment) all live in and are re-verified by
// completePointOfSale itself. This schema exists to reject malformed
// requests before they reach the domain layer, not to duplicate its logic.
const saleLineSchema = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().optional().nullable(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0).optional(),
  priceOverride: z.boolean().optional(),
  discountAmount: z.number().min(0).optional(),
  taxAmount: z.number().min(0).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  warehouseId: z.string().uuid().optional(),
  warehouseLocationId: z.string().uuid().optional().nullable(),
  batchId: z.string().uuid().optional().nullable(),
  serialId: z.string().uuid().optional().nullable(),
  unitCost: z.number().min(0).optional(),
});

const salePaymentSchema = z.object({
  method: z.enum(["cash", "card", "upi", "bank_transfer", "wallet", "store_credit"]),
  amount: z.number().positive(),
});

const completeSaleSchema = z.object({
  shiftId: z.string().uuid(),
  lines: z.array(saleLineSchema).min(1),
  payments: z.array(salePaymentSchema).min(1),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().max(200).optional().nullable(),
  currencyCode: z.string().trim().length(3).optional(),
  roundingAdjustment: z.number().optional(),
  receiptNumber: z.string().trim().max(60).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPointOfSaleResource(client, posContext(session), "sales", {
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
        shiftId: url.searchParams.get("shiftId") || null,
      });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = completeSaleSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create", { mutation: true });
      return completePointOfSale(client, posContext(session), input);
    });
    return ok({ sale: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
