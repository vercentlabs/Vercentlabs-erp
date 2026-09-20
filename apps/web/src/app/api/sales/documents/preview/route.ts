import { previewSalesDocument } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

// A preview never persists anything, so it needs only the read permission a
// user already has to see prices; creating/revising is what needs create.
//
// It returns an explicit projection, NOT the domain object: previewSalesDocument
// returns its working state (customer/master snapshots, pricing and tax traces,
// cost and margin). Every other Sales read redacts cost/margin for a user
// without sales.margin.view, so this must too -- otherwise the pricing preview
// would be the one path that leaks item cost to any sales.view user.
export async function POST(request: Request) {
  return salesMutation(request, "sales.view", documentSchema, async (client, context, input) => {
    const preview = await previewSalesDocument(client, context, input);
    const canSeeMargin = context.roleSlugs.includes("organization_owner") || context.permissions.includes("sales.margin.view");
    const totals = preview.totals as Record<string, unknown>;
    return {
      preview: {
        totals: {
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          chargeTotal: totals.chargeTotal,
          taxTotal: totals.taxTotal,
          roundingAdjustment: totals.roundingAdjustment,
          grandTotal: totals.grandTotal,
          baseCurrencyTotal: totals.baseCurrencyTotal,
          maximumDiscountPercent: totals.maximumDiscountPercent,
          ...(canSeeMargin ? { marginAmount: totals.marginAmount, marginPercent: totals.marginPercent } : {}),
        },
        lines: (preview.lines as Array<Record<string, unknown>>).map((line) => ({
          sequence: line.sequence,
          itemCodeSnapshot: line.itemCodeSnapshot,
          itemNameSnapshot: line.itemNameSnapshot,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          listUnitPrice: line.listUnitPrice,
          discountPercent: line.discountPercent,
          discountAmount: line.discountAmount,
          netAmount: line.netAmount,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
        })),
      },
    };
  });
}
