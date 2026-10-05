// The one tax calculation. Sales (quotations, orders), invoices made from
// them and POS all resolve and calculate tax here, so a document never gets a
// different tax in a different module.
//
//   product / service → tax category → the rate in force on the document date
//   seller registration state + place of supply → intra-state or inter-state
//   GST: intra-state CGST + SGST, inter-state IGST; CESS on top when set
//   taxable value × component rate = component amount; tax = their sum
//
// The caller owns the taxable value (price, quantity, discounts); this module
// decides which tax applies and calculates the amounts from that value. A tax
// amount sent by a client is never used.
import { add, decimal, div, mul, percent, roundMoney, sub } from "../decimal.js";
import { TaxError, dayOf, gstStateName, isUuid, treatmentOfSupply } from "./constants.js";

// The organization's tax set-up for a document: whether tax applies at all,
// and the company registration (GSTIN, state) that issues the document.
// sellerRegistrationId: the chosen registration, else the default one.
export async function loadTaxContext(client, { organizationId, sellerRegistrationId = null }) {
  const settings = (await client.query(
    `SELECT organization.country_code, COALESCE(settings.tax_enabled, true) AS tax_enabled, settings.default_tax_category_id
       FROM public.organizations organization
       LEFT JOIN tenant.tax_settings settings ON settings.organization_id = organization.id
      WHERE organization.id = $1`, [organizationId])).rows[0] ?? {};
  let registration = null;
  if (sellerRegistrationId) {
    if (!isUuid(sellerRegistrationId)) throw new TaxError(400, "The company tax registration is not valid.", "TAX_REGISTRATION_INVALID");
    registration = (await client.query(`SELECT * FROM tenant.tax_registrations WHERE organization_id = $1 AND id = $2`, [organizationId, sellerRegistrationId])).rows[0];
    if (!registration) throw new TaxError(409, "The company tax registration was not found.", "TAX_REGISTRATION_INVALID");
    if (registration.status !== "active") throw new TaxError(409, `The tax registration ${registration.name} is inactive.`, "TAX_REGISTRATION_INACTIVE");
  } else {
    registration = (await client.query(`SELECT * FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at LIMIT 1`,
      [organizationId])).rows[0] ?? null;
  }
  return {
    organizationId,
    enabled: settings.tax_enabled !== false,
    countryCode: String(settings.country_code ?? "").trim() || null,
    defaultTaxCategoryId: settings.default_tax_category_id ?? null,
    registration: registration && sellerSnapshot(registration),
  };
}

// The seller as kept on a document.
export function sellerSnapshot(registration) {
  return {
    id: registration.id, code: registration.code, name: registration.name, legalName: registration.legal_name ?? null, gstin: registration.registration_number ?? null,
    countryCode: String(registration.country_code ?? "").trim() || null, stateCode: registration.state_code ?? null,
    stateName: registration.state_name ?? gstStateName(registration.state_code),
    address: [registration.address_line1, registration.address_line2, registration.city, registration.postal_code].filter(Boolean).join(", ") || null,
  };
}

// The place of supply worked out from the document: where the goods or
// services go (shipping), else where they are billed, else the customer's
// own state. Returns { code, name, basis } or null.
export function derivePlaceOfSupply({ shippingStateCode, billingStateCode, customerPlaceOfSupply, customerStateCode }) {
  const candidates = [[shippingStateCode, "shipping address"], [billingStateCode, "billing address"], [customerPlaceOfSupply, "customer"], [customerStateCode, "customer"]];
  for (const [value, basis] of candidates) {
    const code = String(value ?? "").trim();
    if (code) return { code, name: gstStateName(code), basis };
  }
  return null;
}

// Which tax applies to one line.
//   taxCategoryId   the product's tax category (null: no tax)
//   date            the document date; the rate in force on it is used
//   sellerStateCode, placeOfSupply   decide intra-state or inter-state
//   supplyType      the document's supply type (export, SEZ, exempt … charge nothing)
//   allowInactive   a carried line keeps a category that has since been made inactive
// Returns { treatment, taxType, categoryId, categoryCode, categoryName, rateId,
//   rate, cessRate, components: [{ type, label, rate }], supplyNature,
//   reverseCharge, needsPlaceOfSupply }.
export async function resolveLineTax(client, tax, { taxCategoryId, date, sellerStateCode, placeOfSupply, supplyType = "domestic", allowInactive = false } = {}) {
  const none = (treatment, extra = {}) => ({
    treatment, taxType: "none", categoryId: null, categoryCode: null, categoryName: null, rateId: null, rate: decimal(0), cessRate: decimal(0), components: [],
    supplyNature: null, reverseCharge: false, needsPlaceOfSupply: false, ...extra,
  });
  if (!tax.enabled) return none("non_taxable");
  if (!taxCategoryId) return none(treatmentOfSupply(supplyType) === "taxable" ? "non_taxable" : treatmentOfSupply(supplyType));
  const category = (await client.query(
    `SELECT id, code, name, tax_type, treatment, reverse_charge, status FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2`, [tax.organizationId, taxCategoryId])).rows[0];
  if (!category) throw new TaxError(409, "A product's tax category was not found.", "TAX_CATEGORY_INVALID");
  if (category.status !== "active" && !allowInactive)
    throw new TaxError(409, `The tax category ${category.name} is inactive. Choose another tax category on the product.`, "TAX_CATEGORY_INACTIVE");
  const identity = { categoryId: category.id, categoryCode: category.code, categoryName: category.name, reverseCharge: Boolean(category.reverse_charge) };
  const documentTreatment = treatmentOfSupply(supplyType);
  // The document's treatment (export, exempt supply …) wins over the product's.
  if (documentTreatment !== "taxable") return none(documentTreatment, identity);
  if (category.treatment !== "taxable" || category.tax_type === "none") return none(category.treatment === "taxable" ? "non_taxable" : category.treatment, identity);

  const day = dayOf(date) ?? dayOf(new Date());
  const rateRow = (await client.query(
    `SELECT id, rate, cess_rate, name FROM tenant.tax_rates
      WHERE organization_id = $1 AND tax_category_id = $2 AND status = 'active' AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date)
      ORDER BY effective_from DESC LIMIT 1`, [tax.organizationId, category.id, day])).rows[0];
  if (!rateRow) throw new TaxError(409, `The tax category ${category.name} has no rate on ${day}.`, "TAX_RATE_MISSING");
  const rate = decimal(rateRow.rate);
  const cessRate = decimal(rateRow.cess_rate || 0);
  const components = [];
  let supplyNature = null;
  let needsPlaceOfSupply = false;
  if (category.tax_type === "gst") {
    const seller = String(sellerStateCode ?? "").trim();
    const buyer = String(placeOfSupply ?? "").trim();
    needsPlaceOfSupply = (rate > 0n || cessRate > 0n) && (!seller || !buyer);
    supplyNature = seller && buyer ? (seller === buyer ? "intra_state" : "inter_state") : null;
    if (rate > 0n) {
      if (supplyNature === "intra_state") components.push({ type: "cgst", label: "CGST", rate: div(rate, 2) }, { type: "sgst", label: "SGST", rate: div(rate, 2) });
      else components.push({ type: "igst", label: "IGST", rate });
    }
  } else if (rate > 0n) components.push({ type: category.tax_type, label: rateRow.name || category.name, rate });
  if (cessRate > 0n) components.push({ type: "cess", label: "CESS", rate: cessRate });
  return { treatment: "taxable", taxType: category.tax_type, ...identity, rateId: rateRow.id, rate, cessRate, components, supplyNature, needsPlaceOfSupply };
}

// The amounts for one line.
//   base       the line's value after discounts: the taxable value when prices
//              exclude tax, the value including tax when they include it
//   inclusive  prices include tax (the price list's tax mode)
// Each component is rounded to the currency; the line's tax is their sum, so
// components always add up to the tax shown. For tax-inclusive prices the tax
// is backed out of the value and shared across the components.
export function computeTax({ base, inclusive = false, components, decimalPlaces = 2 }) {
  const value = decimal(base);
  const totalRate = components.reduce((total, component) => add(total, component.rate), decimal(0));
  if (!components.length || totalRate === 0n)
    return { taxableAmount: value, taxAmount: decimal(0), totalRate, components: components.map((component) => ({ ...component, taxableAmount: value, taxAmount: decimal(0) })) };
  if (!inclusive) {
    const lines = components.map((component) => ({ ...component, taxableAmount: value, taxAmount: roundMoney(percent(value, component.rate), decimalPlaces) }));
    return { taxableAmount: value, taxAmount: lines.reduce((total, line) => add(total, line.taxAmount), decimal(0)), totalRate, components: lines };
  }
  const taxableAmount = roundMoney(div(mul(value, 100), add(100, totalRate)), decimalPlaces);
  const taxAmount = sub(value, taxableAmount);
  let allocated = decimal(0);
  const lines = components.map((component, index) => {
    const amount = index === components.length - 1 ? sub(taxAmount, allocated) : roundMoney(div(mul(taxAmount, component.rate), totalRate), decimalPlaces);
    allocated = add(allocated, amount);
    return { ...component, taxableAmount, taxAmount: amount };
  });
  return { taxableAmount, taxAmount, totalRate, components: lines };
}

// A document's tax by component and rate (CGST 9% on …, SGST 9% on …), from its line tax rows.
// lines: [{ taxType, label, rate, taxableAmount, taxAmount }]
export function summarizeTax(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = `${line.taxType}:${decimal(line.rate)}`;
    const group = groups.get(key) ?? { taxType: line.taxType, label: line.label, rate: decimal(line.rate), taxableAmount: decimal(0), taxAmount: decimal(0) };
    group.taxableAmount = add(group.taxableAmount, line.taxableAmount);
    group.taxAmount = add(group.taxAmount, line.taxAmount);
    groups.set(key, group);
  }
  const order = ["cgst", "sgst", "igst", "cess"];
  return [...groups.values()].sort((a, b) => (order.indexOf(a.taxType) + 99) % 99 - (order.indexOf(b.taxType) + 99) % 99 || Number(a.rate - b.rate));
}
