// TDS on supplier advances (Procurement report Phase 2). The law deducts TDS when the supplier is credited or paid, whichever comes first,
// so an advance paid before the bill carries its own TDS: the supplier is credited the full advance, paid the advance less TDS, and the TDS
// is owed to the government (Finance books it with the payment). When the order's bill is finalised, the TDS already deducted on its
// advances (same section) counts towards the bill's TDS, so only the balance is deducted from the bill; a cancelled bill gives it back.
//
// 194Q (TDS on purchase of goods) applies only to a buyer whose turnover passed ₹10 crore last year: a company setting, off by default.
import { decimal, formatDecimal, min, percent, roundMoney } from "../../../core/decimal.js";
import { effectiveWithholdingRate } from "../../../core/tax/withholding.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const PAID = "('posted', 'partially_applied', 'applied')";

export const is194Q = (section) => String(section?.code ?? "").replace(/\s+/g, "").toUpperCase() === "194Q";

export async function tds194qApplies(client, organizationId) {
  return Boolean((await client.query(`SELECT tds_194q_applies FROM tenant.procurement_settings WHERE organization_id = $1`, [organizationId])).rows[0]?.tds_194q_applies);
}

// The TDS on an advance of `amount` against an order: the supplier's usual section unless another (or none: null) is given.
// Returns { section: { id, code } | null, rate, amount (string), reason }.
export async function advanceWithholding(client, organizationId, { supplierId, amount, sectionId, date }) {
  const supplier = (await client.query(
    `SELECT supplier.id, supplier.supplier_type, supplier.withholding_section_id, party.pan FROM tenant.procurement_suppliers supplier
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id WHERE supplier.organization_id = $1 AND supplier.id = $2`,
    [organizationId, supplierId])).rows[0];
  const chosen = sectionId === undefined ? supplier?.withholding_section_id ?? null : sectionId;
  const none = { section: null, rate: "0", amount: "0.00", reason: null };
  if (!supplier || !chosen) return none;
  const section = (await client.query(`SELECT * FROM tenant.withholding_tax_sections WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [organizationId, chosen])).rows[0];
  if (!section) return none;
  if (is194Q(section) && !(await tds194qApplies(client, organizationId)))
    return { ...none, reason: "TDS 194Q is not deducted: it is switched off in Procurement Setup (turnover up to ₹10 crore)." };
  const effective = await effectiveWithholdingRate(client, organizationId, { section, supplier, billDate: date, taxable: String(amount) });
  const tds = roundMoney(percent(decimal(amount), decimal(effective.rate)), 2);
  return { section: { id: section.id, code: section.code }, rate: effective.rate, amount: dec(tds), reason: effective.reason };
}

// What TDS the order's paid advances under the section still hold for its bills.
export async function advanceTdsAvailable(client, organizationId, orderId, sectionId) {
  if (!orderId || !sectionId) return 0n;
  const row = (await client.query(
    `SELECT COALESCE(sum(withholding_amount - withholding_used), 0) AS available FROM tenant.accounting_vendor_payments
      WHERE organization_id = $1 AND purchase_order_id = $2 AND withholding_section_id = $3 AND status IN ${PAID} AND withholding_amount > withholding_used`,
    [organizationId, orderId, sectionId])).rows[0];
  return decimal(row?.available ?? 0);
}

// The bill's TDS less what its order's advances already deducted: { rate (the bill's effective rate), credit } — rate is unchanged when
// nothing is credited. taxable and rate as decimals.
export async function billRateAfterAdvances(client, organizationId, { orderId, sectionId, taxable, rate }) {
  const available = await advanceTdsAvailable(client, organizationId, orderId, sectionId);
  const billTds = roundMoney(percent(taxable, rate), 2);
  if (available <= 0n || billTds <= 0n) return { rate: dec(rate), credit: 0n };
  const credit = min(available, billTds);
  const remaining = billTds - credit;
  // The rate that withholds the remaining TDS on the bill's taxable value.
  const adjusted = remaining <= 0n ? 0n : (remaining * 100n * 1_000_000n) / taxable;
  return { rate: dec(adjusted), credit };
}

// When the bill is finalised: its credit is taken from the order's advances, oldest first. Fails when the advances no longer hold it.
export async function useAdvanceTds(client, context, bill) {
  let left = decimal(bill.advance_withholding_credit ?? 0);
  if (left <= 0n) return;
  const advances = (await client.query(
    `SELECT id, withholding_amount - withholding_used AS available FROM tenant.accounting_vendor_payments
      WHERE organization_id = $1 AND purchase_order_id = $2 AND withholding_section_id = $3 AND status IN ${PAID} AND withholding_amount > withholding_used
      ORDER BY payment_date, created_at FOR UPDATE`, [context.organizationId, bill.source_purchase_order_id, bill.withholding_section_id])).rows;
  for (const advance of advances) {
    if (left <= 0n) break;
    const take = min(left, decimal(advance.available));
    await client.query(`UPDATE tenant.accounting_vendor_payments SET withholding_used = withholding_used + $3 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, advance.id, dec(take)]);
    await client.query(`INSERT INTO tenant.procurement_advance_tds_uses (organization_id, vendor_bill_id, vendor_payment_id, amount, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [context.organizationId, bill.id, advance.id, dec(take), context.userId ?? null]);
    left -= take;
  }
  if (left > 0n) return { short: dec(left) };
  return null;
}

// A cancelled bill gives its TDS credit back to the advances.
export async function releaseAdvanceTds(client, context, billId) {
  const uses = (await client.query(`SELECT id, vendor_payment_id, amount FROM tenant.procurement_advance_tds_uses WHERE organization_id = $1 AND vendor_bill_id = $2 AND released_at IS NULL FOR UPDATE`,
    [context.organizationId, billId])).rows;
  for (const use of uses) {
    await client.query(`UPDATE tenant.accounting_vendor_payments SET withholding_used = greatest(withholding_used - $3, 0) WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, use.vendor_payment_id, use.amount]);
    await client.query(`UPDATE tenant.procurement_advance_tds_uses SET released_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, use.id]);
  }
}
