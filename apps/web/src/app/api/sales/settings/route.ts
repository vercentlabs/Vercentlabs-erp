import { z } from "zod";

import { getSalesSettings, updateSalesSettings } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  sellerStateCode: z.string().trim().max(4).nullish(),
  defaultQuoteValidityDays: z.number().int().optional(),
  quotationApprovalAmount: z.number().optional(),
  quotationApprovalDiscount: z.number().optional(),
  minimumMarginPercent: z.number().optional(),
  orderApprovalAmount: z.number().optional(),
  allowDirectOrders: z.boolean().optional(),
  invoiceQuantityBasis: z.enum(["ordered", "fulfilled"]).optional(),
  defaultPriceListId: z.string().uuid().nullable().optional(),
});

export async function GET() {
  return salesRead("sales.view", async (client, context) => ({ settings: await getSalesSettings(client, context) }));
}

// The domain validates ranges and demands sales.settings.manage; a saved change
// applies to every later approval decision, so it is a settings-permission write.
export async function PUT(request: Request) {
  return salesMutation(request, "sales.settings.manage", schema, async (client, context, input) => ({ settings: await updateSalesSettings(client, context, input) }));
}
