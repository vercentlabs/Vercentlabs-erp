// Optional products on a quotation (Sales report Phase 3): extras offered beside the lines — a warranty, a spare kit — priced as they
// would be on the quotation but kept out of its total. The customer ticks the ones they want when accepting online; the order made from
// the quotation adds them as lines, priced from the price list the same way.
import { SalesError, previewSalesDocument } from "./index.js";

const MAX_OPTIONAL = 30;

// input: the quotation's document input with optionalLines [{ itemId, uomId?, quantity, description? }]. Returns the priced extras.
export async function priceOptionalLines(client, context, input) {
  const raw = Array.isArray(input.optionalLines) ? input.optionalLines.filter((line) => line?.itemId && Number(line.quantity) > 0) : [];
  if (!raw.length) return [];
  if (raw.length > MAX_OPTIONAL) throw new SalesError(400, `A quotation offers at most ${MAX_OPTIONAL} optional products.`, "SALES_OPTIONAL_LINES_INVALID");
  const preview = await previewSalesDocument(client, context, {
    ...input, lines: raw.map((line) => ({ itemId: line.itemId, uomId: line.uomId || undefined, quantity: Number(line.quantity), description: line.description || undefined })),
    charges: [], documentDiscountType: undefined, documentDiscountValue: undefined, optionalLines: undefined, sectionLines: undefined,
  });
  return preview.lines.map((line, index) => ({
    itemId: line.itemId, uomId: line.uomId, quantity: Number(line.quantity), description: raw[index].description || null, name: line.itemNameSnapshot, unit: line.uomSnapshot,
    unitPrice: Number(line.unitPrice), taxRate: Number(line.taxRate ?? 0), taxableAmount: Number(line.taxableAmount), taxAmount: Number(line.taxAmount), lineTotal: Number(line.lineTotal),
  }));
}

// The extras the customer chose ([indexes] into the version's optional lines), as order lines.
export function chosenOptionalLines(optionalLines, chosen) {
  const list = Array.isArray(optionalLines) ? optionalLines : [];
  return [...new Set(Array.isArray(chosen) ? chosen : [])].filter((index) => Number.isInteger(index) && list[index])
    .map((index) => ({ itemId: list[index].itemId, uomId: list[index].uomId ?? undefined, quantity: list[index].quantity, description: list[index].description ?? undefined }));
}
