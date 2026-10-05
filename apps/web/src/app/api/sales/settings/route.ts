import { z } from "zod";

import { getSalesSettings, updateSalesSettings } from "@vercentlabs/api";

import {
  salesMutation,
  salesRead,
} from "@/features/sales/shared/route-helpers";

const schema = z.object({
  defaultQuoteValidityDays: z.number().int().optional(),
  quotationApprovalAmount: z.number().optional(),
  quotationApprovalDiscount: z.number().optional(),
  minimumMarginPercent: z.number().optional(),
  allowDirectOrders: z.boolean().optional(),
  reserveStockOnConfirm: z.boolean().optional(),
  requireCustomerPo: z.boolean().optional(),
  requireRequestedDeliveryDate: z.boolean().optional(),
  checkAvailabilityOnConfirm: z.boolean().optional(),
  invoiceQuantityBasis: z.enum(["ordered", "fulfilled"]).optional(),
  defaultQuotationTerms: z.string().max(20000).nullish(),
  // Pricing & Discounts (needs sales.discount.manage_settings). A null limit or threshold switches it off.
  allowLineDiscounts: z.boolean().optional(),
  allowDocumentDiscounts: z.boolean().optional(),
  allowPercentDiscounts: z.boolean().optional(),
  allowAmountDiscounts: z.boolean().optional(),
  discountReasonAbovePercent: z.number().min(0).max(100).nullable().optional(),
  discountLimitPercent: z.number().min(0).max(100).nullable().optional(),
  discountLimitElevatedPercent: z.number().min(0).max(100).nullable().optional(),
});

export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => ({
    settings: await getSalesSettings(client, context),
  }));
}

// The domain validates ranges and demands sales.settings.manage; a saved change
// applies to every later approval decision, so it is a settings-permission write.
export async function PUT(request: Request) {
  return salesMutation(
    request,
    "sales.settings.manage",
    schema,
    async (client, context, input) => ({
      settings: await updateSalesSettings(client, context, input),
    }),
  );
}
