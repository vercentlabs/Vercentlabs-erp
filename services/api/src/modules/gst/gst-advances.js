// GSTR-1 tables 11A and 11B (Sales report Phase 2): GST on advances, from Sales' receipt and refund vouchers of one GSTIN and month.
//   11A (at)     advances received this month and not yet used on an invoice (nor refunded) by its end: their tax is paid now
//   11B (atadj)  advances of earlier months used on an invoice, or refunded, this month: the tax paid on them comes off
// An advance received and used in the same month is in neither: the invoice carries the tax. Amounts are in paise, as the return's are.
import { paise } from "./gst-common.js";

const part = (row, fraction) => ({
  taxable: Math.round(paise(row.taxable) * fraction), igst: Math.round(paise(row.igst) * fraction), cgst: Math.round(paise(row.cgst) * fraction),
  sgst: Math.round(paise(row.sgst) * fraction), utgst: 0, cess: 0,
});

// Returns [{ section: "at" | "atadj", sourceType, sourceId, kind, number, date, gstin, name, pos, nature, rate, value (paise), taxable, igst, cgst, sgst, ... }]
export async function collectAdvances(client, c, registration, start, end) {
  const rows = [];
  const issued = (await client.query(
    `SELECT voucher.*, voucher.voucher_date::text AS day,
            COALESCE((SELECT sum(used.amount) FROM tenant.sales_receipt_voucher_adjustments used WHERE used.voucher_id = voucher.id AND used.adjusted_on <= $4::date), 0)
          + COALESCE((SELECT sum(refund.amount) FROM tenant.sales_refund_vouchers refund WHERE refund.receipt_voucher_id = voucher.id AND refund.refund_date <= $4::date), 0) AS settled
       FROM tenant.sales_receipt_vouchers voucher
      WHERE voucher.organization_id = $1 AND voucher.seller_gstin = $2 AND voucher.status <> 'cancelled' AND voucher.voucher_date BETWEEN $3::date AND $4::date
      ORDER BY voucher.voucher_date, voucher.voucher_number`, [c.organizationId, registration.registration_number, start, end])).rows;
  for (const voucher of issued) {
    const open = paise(voucher.amount) - paise(voucher.settled);
    if (open <= 0) continue;
    rows.push({ section: "at", sourceType: "receipt_voucher", sourceId: voucher.id, kind: "receipt_voucher", number: voucher.voucher_number, date: voucher.day,
      gstin: voucher.customer_gstin, name: voucher.customer_name, pos: voucher.place_of_supply, nature: voucher.supply_nature, rate: Number(voucher.rate), value: open,
      ...part(voucher, open / paise(voucher.amount)) });
  }
  const settled = (await client.query(
    `SELECT 'adjustment' AS kind, used.id, used.adjusted_on::text AS day, used.amount, used.taxable, used.igst, used.cgst, used.sgst, invoice.invoice_number AS against,
            voucher.voucher_number, voucher.voucher_date::text AS voucher_day, voucher.customer_gstin, voucher.customer_name, voucher.place_of_supply, voucher.supply_nature, voucher.rate
       FROM tenant.sales_receipt_voucher_adjustments used
       JOIN tenant.sales_receipt_vouchers voucher ON voucher.id = used.voucher_id
       JOIN tenant.accounting_customer_invoices invoice ON invoice.id = used.invoice_id
      WHERE used.organization_id = $1 AND voucher.seller_gstin = $2 AND used.adjusted_on BETWEEN $3::date AND $4::date AND voucher.voucher_date < $3::date
     UNION ALL
     SELECT 'refund', refund.id, refund.refund_date::text, refund.amount, refund.taxable, refund.igst, refund.cgst, refund.sgst, refund.voucher_number,
            voucher.voucher_number, voucher.voucher_date::text, voucher.customer_gstin, voucher.customer_name, voucher.place_of_supply, voucher.supply_nature, voucher.rate
       FROM tenant.sales_refund_vouchers refund
       JOIN tenant.sales_receipt_vouchers voucher ON voucher.id = refund.receipt_voucher_id
      WHERE refund.organization_id = $1 AND voucher.seller_gstin = $2 AND refund.refund_date BETWEEN $3::date AND $4::date AND voucher.voucher_date < $3::date
      ORDER BY 3`, [c.organizationId, registration.registration_number, start, end])).rows;
  for (const entry of settled)
    rows.push({ section: "atadj", sourceType: entry.kind === "refund" ? "refund_voucher" : "receipt_voucher_adjustment", sourceId: entry.id, kind: entry.kind,
      number: entry.kind === "refund" ? entry.against : `${entry.voucher_number} → ${entry.against}`, date: entry.day, gstin: entry.customer_gstin, name: entry.customer_name,
      pos: entry.place_of_supply, nature: entry.supply_nature, rate: Number(entry.rate), value: paise(entry.amount), original: { number: entry.voucher_number, date: entry.voucher_day },
      ...part(entry, 1) });
  return rows;
}
