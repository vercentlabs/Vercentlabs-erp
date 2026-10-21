import { z } from "zod";

import { createSalesChallan, listSalesChallans } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Delivery challans without Stock (Sales audit): ?status=&search=; POST makes one (from an order, or free).
export async function GET(request: Request) {
  const url = new URL(request.url);
  return salesRead(request, "sales.order.view", async (client, context) =>
    listSalesChallans(client, context, { status: url.searchParams.get("status") ?? undefined, search: url.searchParams.get("search") ?? undefined }));
}

const schema = z.object({
  purpose: z.enum(["sale_dispatch", "supply_on_approval", "job_work", "branch_transfer", "exhibition", "other"]).optional(),
  partyId: z.string().uuid().nullish(),
  salesOrderId: z.string().uuid().nullish(),
  challanDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  shippingAddressId: z.string().uuid().nullish(),
  vehicleNumber: z.string().max(20).nullish(),
  transporterName: z.string().max(160).nullish(),
  lrNumber: z.string().max(60).nullish(),
  notes: z.string().max(2000).nullish(),
  lines: z.array(z.object({
    itemId: z.string().uuid().nullish(), salesOrderLineId: z.string().uuid().nullish(), description: z.string().max(500).nullish(),
    quantity: z.number().positive(), unitValue: z.number().min(0).nullish(), hsnSacCode: z.string().max(8).nullish(), unit: z.string().max(20).nullish(),
  })).max(200).optional(),
});

export async function POST(request: Request) {
  return salesMutation(request, "sales.delivery.dispatch", schema, async (client, context, input) => ({ challan: await createSalesChallan(client, context, input) }));
}
