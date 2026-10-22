// TDS / withholding sections: the share of a supplier's bill (its taxable value) the buyer withholds and pays to the tax authority. Part of
// the shared tax set-up, managed with the tax rates; a supplier carries its usual section, and a bill may use another or none.
//
// Shared Platform plan 7: a section can carry the law's rules, and a bill withholds by them —
//   thresholds   nothing is withheld while one bill stays under the single-bill limit AND the financial year's bills to the supplier
//                under the section stay within the yearly limit (194C: ₹30,000 / ₹1,00,000); once crossed, the whole bill is withheld, and the
//                bill that crosses the yearly limit catches up the year's earlier untaxed bills. 194Q (basis excess_over_annual) taxes only
//                the part above its yearly limit (₹50 lakh)
//   party        individuals and HUFs at their own rate (194C 1%), others at the section's rate (2%)
//   no PAN       section 206AA: the rate set for it, else 5% for 194Q and the higher of 20% and twice the rate for the others
//   certificate  a lower-deduction certificate (section 197) for the supplier and section, valid on the bill's date and within its amount,
//                replaces the rate
import { div, formatDecimal, mul } from "../decimal.js";
import { TAX_PERMISSIONS, TaxError, isUuid, requireTaxPermission, text } from "./constants.js";

const amount = (value) => (value === null || value === undefined || value === "" ? null : String(value));
const toSection = (row) => ({
  id: row.id, code: row.code, name: row.name, rate: String(row.rate), status: row.status,
  thresholdSingle: amount(row.threshold_single), thresholdAnnual: amount(row.threshold_annual), rateIndividual: amount(row.rate_individual), rateNoPan: amount(row.rate_no_pan),
  basis: row.basis ?? "full",
});

export async function listWithholdingSections(client, context, { includeInactive = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.withholding_tax_sections WHERE organization_id = $1${includeInactive ? "" : " AND status = 'active'"} ORDER BY code`, [context.organizationId]);
  return rows.map(toSection);
}

const PERCENT = /^\d{1,3}(?:\.\d{1,4})?$/;
const MONEY = /^\d{1,15}(?:\.\d{1,2})?$/;
function optionalNumber(input, key, pattern, message) {
  const value = input[key];
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const cleaned = String(value).replace(/[,₹\s]/g, "");
  if (!pattern.test(cleaned) || (pattern === PERCENT && Number(cleaned) > 100)) throw new TaxError(400, message, "WITHHOLDING_RATE_INVALID", { field: key });
  return cleaned;
}

// input: { code, name, rate, status?, thresholdSingle?, thresholdAnnual?, rateIndividual?, rateNoPan?, basis? (full | excess_over_annual) }
export async function saveWithholdingSection(client, context, sectionId, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageRates, "You do not have permission to manage TDS sections.");
  const code = text(input.code, 20);
  const name = text(input.name, 200);
  const rate = String(input.rate ?? "").trim();
  if (!code) throw new TaxError(400, "Enter the section code (for example 194C).", "WITHHOLDING_CODE_REQUIRED");
  if (!name) throw new TaxError(400, "Describe the section.", "WITHHOLDING_NAME_REQUIRED");
  if (!PERCENT.test(rate) || Number(rate) > 100) throw new TaxError(400, "Enter the rate as a percentage between 0 and 100.", "WITHHOLDING_RATE_INVALID");
  const thresholdSingle = optionalNumber(input, "thresholdSingle", MONEY, "Enter the one-bill limit in rupees.");
  const thresholdAnnual = optionalNumber(input, "thresholdAnnual", MONEY, "Enter the yearly limit in rupees.");
  const rateIndividual = optionalNumber(input, "rateIndividual", PERCENT, "Enter the rate for individuals and HUFs as a percentage.");
  const rateNoPan = optionalNumber(input, "rateNoPan", PERCENT, "Enter the rate without a PAN as a percentage.");
  const status = input.status === "inactive" ? "inactive" : "active";
  // 194Q taxes only the excess over its yearly limit; a section says so, else it follows its code.
  const basis = input.basis === "excess_over_annual" || input.basis === "full" ? input.basis : code.toUpperCase() === "194Q" ? "excess_over_annual" : "full";
  const values = [context.organizationId, code, name, rate, status, thresholdSingle, thresholdAnnual, rateIndividual, rateNoPan, basis];
  try {
    if (sectionId) {
      if (!isUuid(sectionId)) throw new TaxError(404, "TDS section not found.", "WITHHOLDING_NOT_FOUND");
      const row = (await client.query(
        `UPDATE tenant.withholding_tax_sections SET code = $2, name = $3, rate = $4, status = $5, threshold_single = $6, threshold_annual = $7, rate_individual = $8, rate_no_pan = $9,
                basis = $10, updated_at = now() WHERE organization_id = $1 AND id = $11 RETURNING *`, [...values, sectionId])).rows[0];
      if (!row) throw new TaxError(404, "TDS section not found.", "WITHHOLDING_NOT_FOUND");
      return toSection(row);
    }
    return toSection((await client.query(
      `INSERT INTO tenant.withholding_tax_sections (organization_id, code, name, rate, status, threshold_single, threshold_annual, rate_individual, rate_no_pan, basis, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`, [...values, context.userId ?? null])).rows[0]);
  } catch (error) {
    if (error.code === "23505") throw new TaxError(409, `A TDS section ${code} already exists.`, "WITHHOLDING_DUPLICATE");
    throw error;
  }
}

// ------------------------------------------------------------------ lower-deduction certificates (section 197)
const toCertificate = (row) => ({ id: row.id, supplierId: row.supplier_id, sectionId: row.section_id, sectionCode: row.section_code ?? null, certificateNumber: row.certificate_number,
  rate: String(Number(row.rate)), validFrom: row.valid_from_text ?? row.valid_from, validTo: row.valid_to_text ?? row.valid_to, amountLimit: amount(row.amount_limit) });

export async function listTdsCertificates(client, context, supplierId) {
  return (await client.query(
    `SELECT certificate.*, section.code AS section_code, to_char(certificate.valid_from, 'YYYY-MM-DD') AS valid_from_text, to_char(certificate.valid_to, 'YYYY-MM-DD') AS valid_to_text
       FROM tenant.supplier_tds_certificates certificate JOIN tenant.withholding_tax_sections section ON section.id = certificate.section_id
      WHERE certificate.organization_id = $1 AND certificate.supplier_id = $2 ORDER BY certificate.valid_from DESC`, [context.organizationId, supplierId])).rows.map(toCertificate);
}

// input: { supplierId, sectionId, certificateNumber, rate, validFrom, validTo, amountLimit? }
export async function saveTdsCertificate(client, context, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageRates, "You do not have permission to manage TDS certificates.");
  if (!isUuid(input.supplierId) || !isUuid(input.sectionId)) throw new TaxError(400, "Choose the supplier and the TDS section.", "TDS_CERTIFICATE_INVALID");
  const number = text(input.certificateNumber, 40);
  if (!number) throw new TaxError(400, "Enter the certificate number.", "TDS_CERTIFICATE_INVALID", { field: "certificateNumber" });
  const rate = optionalNumber(input, "rate", PERCENT, "Enter the certificate's rate as a percentage.");
  if (rate === null) throw new TaxError(400, "Enter the certificate's rate.", "TDS_CERTIFICATE_INVALID", { field: "rate" });
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(String(input.validFrom ?? "")) || !day.test(String(input.validTo ?? "")) || input.validTo < input.validFrom)
    throw new TaxError(400, "Enter the dates the certificate is valid (from and to).", "TDS_CERTIFICATE_INVALID", { field: "validFrom" });
  const limit = optionalNumber(input, "amountLimit", MONEY, "Enter the amount the certificate covers in rupees.");
  const row = (await client.query(
    `INSERT INTO tenant.supplier_tds_certificates (organization_id, supplier_id, section_id, certificate_number, rate, valid_from, valid_to, amount_limit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9) RETURNING *`,
    [context.organizationId, input.supplierId, input.sectionId, number, rate, input.validFrom, input.validTo, limit, context.userId ?? null])).rows[0];
  return toCertificate(row);
}

export async function deleteTdsCertificate(client, context, certificateId) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageRates, "You do not have permission to manage TDS certificates.");
  const removed = await client.query(`DELETE FROM tenant.supplier_tds_certificates WHERE organization_id = $1 AND id = $2`, [context.organizationId, isUuid(certificateId) ? certificateId : null]);
  if (!removed.rowCount) throw new TaxError(404, "Certificate not found.", "TDS_CERTIFICATE_NOT_FOUND");
  return { deleted: true };
}

// ------------------------------------------------------------------ the rate a bill withholds at
// How much of a bill a section taxes (Procurement plan Phase 0):
//   full                 the whole bill once a limit is crossed (194C, 194J, 194I, 194H). For a section with a yearly limit, the bill that
//                        crosses it also catches up the earlier bills of the year that stayed under the limits untaxed (194C: three small
//                        bills, then one that takes the year past ₹1,00,000 — that bill carries TDS on all four).
//   excess_over_annual   only the part of the year's bills above the yearly limit (194Q: 0.1% on purchases above ₹50 lakh).
// The bill's lines withhold at one rate on their taxable value, so the result is returned as the effective rate on this bill:
// (amount the law taxes ÷ this bill's taxable value) × the section's rate, to six decimals.
const basisOf = (section) => section.basis ?? (String(section.code ?? "").toUpperCase() === "194Q" ? "excess_over_annual" : "full");
const rupees = (value) => `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// section: the section row; supplier: { id, supplier_type, pan }; billDate 'YYYY-MM-DD'; taxable: this bill's taxable value (number);
// excludeBillId: the bill being rebuilt (not counted twice). Returns { rate (string), reason (null or a sentence) }.
export async function effectiveWithholdingRate(client, organizationId, { section, supplier, billDate, taxable, excludeBillId = null }) {
  if (!section) return { rate: "0", reason: null };
  const single = section.threshold_single === null || section.threshold_single === undefined ? null : Number(section.threshold_single);
  const annual = section.threshold_annual === null || section.threshold_annual === undefined ? null : Number(section.threshold_annual);
  const basis = basisOf(section);
  const yearStart = (await client.query(
    `SELECT to_char(make_date(CASE WHEN extract(month FROM $1::date) >= COALESCE((SELECT fiscal_year_start_month FROM public.organizations WHERE id = $2), 4)
                                   THEN extract(year FROM $1::date) ELSE extract(year FROM $1::date) - 1 END::int,
                              COALESCE((SELECT fiscal_year_start_month FROM public.organizations WHERE id = $2), 4), 1), 'YYYY-MM-DD') AS d`, [billDate, organizationId])).rows[0].d;
  // This financial year's bills to the supplier under the section, before this one: their taxable value, and which went untaxed.
  const earlierBills = (await client.query(
    `SELECT bill_number, (COALESCE(taxable_total, subtotal - discount_total) - COALESCE(tcs_amount, 0))::numeric AS taxable, COALESCE(withholding_total, 0)::numeric AS withheld
       FROM tenant.accounting_vendor_bills
      WHERE organization_id = $1 AND supplier_id = $2 AND withholding_section_id = $3 AND status NOT IN ('draft', 'cancelled', 'reversed')
        AND bill_date >= $4::date AND bill_date <= $5::date AND ($6::uuid IS NULL OR id <> $6)
      ORDER BY bill_date, created_at`,
    [organizationId, supplier.id, section.id, yearStart, billDate, excludeBillId])).rows;
  const thisBill = Number(taxable);
  const earlier = earlierBills.reduce((total, bill) => total + Number(bill.taxable), 0);
  const yearToDate = earlier + thisBill;
  const limits = `${single !== null ? `${rupees(single)} a bill` : ""}${single !== null && annual !== null ? ", " : ""}${annual !== null ? `${rupees(annual)} a year` : ""}`;
  const below = { rate: "0", reason: `TDS ${section.code}: below the limits (${limits}), so nothing is withheld.` };
  if (basis === "excess_over_annual") {
    if (annual !== null && yearToDate <= annual) return below;
  } else if ((single !== null || annual !== null) && (single === null || thisBill < single) && (annual === null || yearToDate <= annual)) return below;

  // The rate: a lower-deduction certificate (s.197), else no PAN (s.206AA), else the individual/HUF rate, else the section's rate.
  let rate;
  let why;
  const certificate = (await client.query(
    `SELECT certificate_number, rate, amount_limit FROM tenant.supplier_tds_certificates
      WHERE organization_id = $1 AND supplier_id = $2 AND section_id = $3 AND valid_from <= $4::date AND valid_to >= $4::date ORDER BY valid_from DESC LIMIT 1`,
    [organizationId, supplier.id, section.id, billDate])).rows[0];
  const base = supplier.supplier_type === "individual" && section.rate_individual !== null && section.rate_individual !== undefined ? Number(section.rate_individual) : Number(section.rate);
  if (certificate && (certificate.amount_limit === null || yearToDate <= Number(certificate.amount_limit))) {
    rate = Number(certificate.rate);
    why = `at ${rate}% under lower-deduction certificate ${certificate.certificate_number}`;
  } else if (!String(supplier.pan ?? "").trim()) {
    // s.206AA: the rate set on the section; by default 5% for 194Q, else the higher of 20% and twice the rate.
    rate = section.rate_no_pan !== null && section.rate_no_pan !== undefined ? Number(section.rate_no_pan) : basis === "excess_over_annual" ? 5 : Math.max(20, base * 2);
    why = `at ${rate}%: the supplier has no PAN (section 206AA)`;
  } else {
    rate = base;
    why = base !== Number(section.rate) ? `at the individual/HUF rate of ${base}%` : `at ${base}%`;
  }

  // What the law taxes on this bill.
  let taxedAmount = thisBill;
  const notes = [];
  if (basis === "excess_over_annual" && annual !== null) {
    taxedAmount = Math.min(thisBill, yearToDate - annual);
    if (taxedAmount < thisBill) notes.push(`only ${rupees(taxedAmount)} of this bill is above the ${rupees(annual)} a year limit`);
  } else if (annual !== null && earlier <= annual && yearToDate > annual) {
    // This bill takes the year past the yearly limit: catch up the earlier bills that went untaxed.
    const untaxed = earlierBills.filter((bill) => Number(bill.withheld) === 0 && Number(bill.taxable) > 0);
    const catchUp = untaxed.reduce((total, bill) => total + Number(bill.taxable), 0);
    if (catchUp > 0) {
      taxedAmount = thisBill + catchUp;
      notes.push(`includes ${rupees(catchUp)} from earlier bills of the year that were under the limit (${untaxed.map((bill) => bill.bill_number).filter(Boolean).join(", ")})`);
    }
  }
  if (thisBill <= 0 || taxedAmount <= 0) return { rate: "0", reason: null };
  // TDS never exceeds the bill it is withheld from: a catch-up bigger than this bill leaves the rest for the next bill or payment.
  const maxTaxed = (thisBill * 100) / rate;
  if (rate > 0 && taxedAmount > maxTaxed) {
    notes.push(`${rupees(((taxedAmount - maxTaxed) * rate) / 100)} of the catch-up is more than this bill can carry: withhold it from the next bill or payment`);
    taxedAmount = maxTaxed;
  }
  const effective = formatDecimal(div(mul(String(rate), taxedAmount.toFixed(6)), thisBill.toFixed(6)));
  const reason = notes.length || rate !== Number(section.rate) ? `TDS ${section.code} ${why}${notes.length ? `; ${notes.join("; ")}` : ""}.` : null;
  return { rate: effective, reason };
}
