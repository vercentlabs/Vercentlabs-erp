import "server-only";

type Context = { permissions: string[]; roleSlugs: string[] };

// What a pricing preview returns to the browser: an explicit projection, NOT
// the domain object. previewSalesDocument returns its working state (customer
// and master snapshots, pricing and tax traces, cost and margin). Every other
// Sales read redacts cost and margin for a user without sales.margin.view, so
// this must too -- otherwise the preview would be the one path that leaks
// item cost to any sales user.
export function projectDocumentPreview(preview: Record<string, unknown>, context: Context) {
  const discount = preview.discount as Record<string, unknown>;
  const tax = preview.tax as Record<string, unknown>;
  const master = preview.master as { priceList?: { id: string; code: string; name: string; currencyCode: string; taxInclusive: boolean; basis: string } | null };
  const canSeeMargin =
    context.roleSlugs.includes("organization_owner") ||
    context.permissions.includes("sales.margin.view");
  const totals = preview.totals as Record<string, unknown>;
  return {
    priceList: master.priceList
      ? { id: master.priceList.id, code: master.priceList.code, name: master.priceList.name, currencyCode: master.priceList.currencyCode, taxInclusive: master.priceList.taxInclusive, basis: master.priceList.basis }
      : null,
    totals: {
      subtotal: totals.subtotal,
      grossTotal: totals.grossTotal,
      lineDiscountTotal: totals.lineDiscountTotal,
      documentDiscountType: totals.documentDiscountType,
      documentDiscountValue: totals.documentDiscountValue,
      documentDiscountPercent: totals.documentDiscountPercent,
      documentDiscountAmount: totals.documentDiscountAmount,
      taxableTotal: totals.taxableTotal,
      discountTotal: totals.discountTotal,
      chargeTotal: totals.chargeTotal,
      taxTotal: totals.taxTotal,
      roundingAdjustment: totals.roundingAdjustment,
      grandTotal: totals.grandTotal,
      baseCurrencyTotal: totals.baseCurrencyTotal,
      maximumDiscountPercent: totals.maximumDiscountPercent,
      ...(canSeeMargin
        ? {
            marginAmount: totals.marginAmount,
            marginPercent: totals.marginPercent,
          }
        : {}),
    },
    // Who issues the document, the place of supply, and the tax by component and rate.
    tax: {
      enabled: tax.enabled, seller: tax.seller, supplyType: tax.supplyType, derivedSupplyType: tax.derivedSupplyType, treatment: tax.treatment,
      placeOfSupply: tax.placeOfSupply, supplyNature: tax.supplyNature, summary: tax.summary,
    },
    discount: {
      requestedPercent: discount.requestedPercent,
      limitPercent: discount.limitPercent,
      limitExceeded: discount.limitExceeded,
      reasonRequired: discount.reasonRequired,
      message: discount.message,
    },
    lines: (preview.lines as Array<Record<string, unknown>>).map(
      (line) => ({
        sequence: line.sequence,
        itemCodeSnapshot: line.itemCodeSnapshot,
        itemNameSnapshot: line.itemNameSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        listUnitPrice: line.listUnitPrice,
        manualPriceOverride: line.manualPriceOverride,
        priceMissing: line.priceMissing,
        priceMessage: line.priceMessage,
        priceSource: (line.pricingTrace as { priceSource?: string } | undefined)?.priceSource ?? null,
        discountType: line.discountType,
        discountValue: line.discountValue,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
        grossAmount: line.grossAmount,
        netAmount: line.netAmount,
        documentDiscountAmount: line.documentDiscountAmount,
        taxableAmount: line.taxableAmount,
        taxRate: line.taxRate,
        taxTreatment: line.taxTreatment,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
      }),
    ),
  };
}
