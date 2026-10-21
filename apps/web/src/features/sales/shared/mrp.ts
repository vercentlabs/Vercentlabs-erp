import { money } from "./format";

// The line's MRP and the retailer's margin on it: MRP less what the retailer pays per unit (tax included), as a share of the MRP.
export function mrpNote(line: { mrp?: string | null; quantity: string; lineTotal: string }, currencyCode: string) {
  const mrp = Number(line.mrp ?? 0);
  const quantity = Number(line.quantity);
  if (!(mrp > 0) || !(quantity > 0)) return "";
  const paid = Number(line.lineTotal) / quantity;
  return ` · MRP ${money(currencyCode, mrp)} · retailer margin ${(((mrp - paid) / mrp) * 100).toFixed(1)}%`;
}
