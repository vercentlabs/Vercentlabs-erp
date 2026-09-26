import { z } from "zod";

import { completePointOfSale, listPosTransactions } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

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

// F268-F307 completion gap closure -- the Transactions workspace's search
// screen. listPosTransactions (transaction-continuity-and-documents/
// transactions.js) is a superset of the old listPointOfSaleResource(
// "sales") call this route used to make: same store-scoping, same
// shiftId filter, plus receipt-number search, terminal/cashier/status/
// date-range/payment-method filters, sorting and a real total count for
// pagination. Nothing else in the app called this route's GET before
// this feature existed, so widening it here is not a breaking change.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const params = url.searchParams;
    const result = await listPosTransactions(client, posContext(session), {
      search: params.get("search") || undefined,
      storeId: params.get("storeId") || undefined,
      terminalId: params.get("terminalId") || undefined,
      cashierId: params.get("cashierId") || undefined,
      shiftId: params.get("shiftId") || undefined,
      customerId: params.get("customerId") || undefined,
      status: params.get("status") || undefined,
      dateFrom: params.get("dateFrom") || undefined,
      dateTo: params.get("dateTo") || undefined,
      paymentMethod: params.get("paymentMethod") || undefined,
      sortBy: (params.get("sortBy") as "sale_date" | "grand_total" | "receipt_number" | "status") || undefined,
      sortDir: (params.get("sortDir") as "asc" | "desc") || undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      offset: params.get("offset") ? Number(params.get("offset")) : undefined,
    });
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.sale.create", billingWrite: true }, async ({ client, session }) => {
    const input = completeSaleSchema.parse(await readJson(request));
    const result = await completePointOfSale(client, posContext(session), input);
    return ok({ sale: result }, 201);
  });
}
