// Checking the tax set-up, and trying a calculation, before a document depends on it. Both read only.
//
// validateTaxConfiguration lists what would stop a sale or make its tax wrong: no registration while tax is on, a registration that is
// expired, not yet valid or under a regime POS cannot bill (composition …), an outlet without one, a taxable category with no rate in force
// today (a gap) or with rates that overlap, sellable products with no tax category or an invalid HSN/SAC. Errors block sales; warnings
// deserve a look.
//
// previewTaxCalculation runs one line through the shared engine — the same code every document uses — so an administrator can see what a
// category, a price basis and a place of supply would charge.
import { asDatabaseDecimal, decimal } from "../decimal.js";
import { TAX_PERMISSIONS, TaxError, dayOf, gstStateName, isUuid, requireTaxPermission } from "./constants.js";
import { computeTax, loadTaxContext, resolveLineTax } from "./engine.js";

const HSN_PATTERN = /^[0-9]{4}([0-9]{2}){0,2}$/;
const SAC_PATTERN = /^99[0-9]{4}$/;

export async function validateTaxConfiguration(client, context) {
  requireTaxPermission(context, TAX_PERMISSIONS.view, "You do not have permission to view tax configuration.");
  const issues = [];
  const issue = (severity, code, message, extra = {}) => issues.push({ severity, code, message, ...extra });
  const org = (await client.query(
    `SELECT organization.country_code, COALESCE(settings.tax_enabled, true) AS tax_enabled, settings.default_tax_category_id,
            to_char((now() AT TIME ZONE COALESCE(organization.timezone, 'Asia/Kolkata'))::date, 'YYYY-MM-DD') AS today
       FROM public.organizations organization LEFT JOIN tenant.tax_settings settings ON settings.organization_id = organization.id WHERE organization.id = $1`,
    [context.organizationId])).rows[0] ?? {};
  const today = org.today;
  const india = String(org.country_code ?? "").trim() === "IN";
  if (!org.tax_enabled) issue("warning", "TAX_DISABLED", "Tax is switched off: no document charges tax. Switch it on once the company is registered.");

  const registrations = (await client.query(`SELECT * FROM tenant.tax_registrations WHERE organization_id = $1 ORDER BY is_default DESC, name`, [context.organizationId])).rows;
  const active = registrations.filter((row) => row.status === "active");
  if (org.tax_enabled && !active.length) issue("error", "TAX_REGISTRATION_MISSING", "Tax is on but there is no active tax registration. Add the company's GST registration.");
  for (const row of active) {
    const from = dayOf(row.valid_from);
    const until = dayOf(row.valid_until);
    if (until && until < today) issue("error", "TAX_REGISTRATION_EXPIRED", `${row.name} ended on ${until}.`, { entity: { type: "registration", id: row.id } });
    else if (from && from > today) issue("warning", "TAX_REGISTRATION_NOT_YET_VALID", `${row.name} starts on ${from}.`, { entity: { type: "registration", id: row.id } });
    if ((row.registration_type ?? "regular") !== "regular")
      issue("warning", "TAX_REGISTRATION_SPECIAL_REGIME", `${row.name} is under a special regime (${String(row.registration_type).replace(/_/g, " ")}): POS will not bill under it.`,
        { entity: { type: "registration", id: row.id } });
  }

  const outlets = (await client.query(
    `SELECT store.id, store.code, store.name, store.tax_registration_id, registration.name AS registration_name, registration.status AS registration_status,
            registration.registration_type, registration.valid_until
       FROM tenant.pos_stores store LEFT JOIN tenant.tax_registrations registration ON registration.organization_id = store.organization_id AND registration.id = store.tax_registration_id
      WHERE store.organization_id = $1 AND store.active ORDER BY store.code`, [context.organizationId])).rows;
  for (const outlet of outlets) {
    const entity = { type: "outlet", id: outlet.id };
    if (!outlet.tax_registration_id) {
      if (org.tax_enabled) issue("warning", "TAX_OUTLET_REGISTRATION_DEFAULT", `Outlet ${outlet.code} has no registration of its own and bills under the company default.`, { entity });
    } else if (outlet.registration_status !== "active") issue("error", "TAX_OUTLET_REGISTRATION_INACTIVE", `Outlet ${outlet.code} bills under ${outlet.registration_name}, which is inactive.`, { entity });
    else if ((outlet.registration_type ?? "regular") !== "regular")
      issue("error", "TAX_OUTLET_REGISTRATION_REGIME", `Outlet ${outlet.code} bills under ${outlet.registration_name}, a special regime POS cannot bill under.`, { entity });
    else if (dayOf(outlet.valid_until) && dayOf(outlet.valid_until) < today)
      issue("error", "TAX_OUTLET_REGISTRATION_EXPIRED", `Outlet ${outlet.code} bills under ${outlet.registration_name}, which has ended.`, { entity });
  }

  // Taxable categories: a rate in force today (no gap), and never two rates for the same day (no overlap).
  const categories = (await client.query(
    `SELECT category.id, category.code, category.name,
            EXISTS (SELECT 1 FROM tenant.tax_rates rate WHERE rate.organization_id = category.organization_id AND rate.tax_category_id = category.id AND rate.status = 'active'
                      AND rate.effective_from <= $2::date AND (rate.effective_to IS NULL OR rate.effective_to >= $2::date)) AS has_rate,
            EXISTS (SELECT 1 FROM tenant.tax_rates one JOIN tenant.tax_rates two ON two.organization_id = one.organization_id AND two.tax_category_id = one.tax_category_id
                      AND two.id <> one.id AND two.status = 'active'
                      AND daterange(two.effective_from, COALESCE(two.effective_to, 'infinity'::date), '[]') && daterange(one.effective_from, COALESCE(one.effective_to, 'infinity'::date), '[]')
                     WHERE one.organization_id = category.organization_id AND one.tax_category_id = category.id AND one.status = 'active') AS overlapping
       FROM tenant.tax_categories category
      WHERE category.organization_id = $1 AND category.status = 'active' AND category.treatment = 'taxable' AND category.tax_type <> 'none'
      ORDER BY category.code`, [context.organizationId, today])).rows;
  for (const category of categories) {
    const entity = { type: "category", id: category.id };
    if (!category.has_rate) issue("error", "TAX_RATE_GAP", `${category.code} (${category.name}) has no rate in force today: products in it cannot be sold.`, { entity });
    if (category.overlapping) issue("error", "TAX_RATE_OVERLAP", `${category.code} (${category.name}) has rates whose dates overlap.`, { entity });
  }

  // Sellable products: a tax category (or the company default) and, in India, a valid HSN (goods) or SAC (services).
  if (org.tax_enabled) {
    const unclassified = (await client.query(
      `SELECT count(*)::int AS total, (array_agg(code ORDER BY code))[1:5] AS sample FROM tenant.items
        WHERE organization_id = $1 AND status = 'active' AND is_sellable AND tax_category_id IS NULL AND $2::uuid IS NULL`,
      [context.organizationId, org.default_tax_category_id ?? null])).rows[0];
    if (unclassified.total) issue("error", "TAX_ITEM_CLASSIFICATION_MISSING", `${unclassified.total} sellable product(s) have no tax category (${unclassified.sample.join(", ")}${unclassified.total > 5 ? ", …" : ""}).`);
    const inactive = (await client.query(
      `SELECT count(*)::int AS total, (array_agg(item.code ORDER BY item.code))[1:5] AS sample FROM tenant.items item
         JOIN tenant.tax_categories category ON category.organization_id = item.organization_id AND category.id = item.tax_category_id
        WHERE item.organization_id = $1 AND item.status = 'active' AND item.is_sellable AND category.status <> 'active'`, [context.organizationId])).rows[0];
    if (inactive.total) issue("error", "TAX_ITEM_CATEGORY_INACTIVE", `${inactive.total} sellable product(s) use an inactive tax category (${inactive.sample.join(", ")}${inactive.total > 5 ? ", …" : ""}).`);
    if (india) {
      const codes = (await client.query(
        `SELECT code, item_type, regexp_replace(COALESCE(hsn_sac_code, ''), '[\\s.]', '', 'g') AS hsn FROM tenant.items WHERE organization_id = $1 AND status = 'active' AND is_sellable`,
        [context.organizationId])).rows;
      const bad = codes.filter((row) => !(row.item_type === "service" ? SAC_PATTERN : HSN_PATTERN).test(row.hsn));
      if (bad.length) issue("error", "TAX_HSN_SAC_INVALID", `${bad.length} sellable product(s) have no valid HSN or SAC code (${bad.slice(0, 5).map((row) => row.code).join(", ")}${bad.length > 5 ? ", …" : ""}).`);
    }
  }

  return {
    checkedAt: new Date().toISOString(), today, ok: !issues.some((entry) => entry.severity === "error"),
    errors: issues.filter((entry) => entry.severity === "error").length, warnings: issues.filter((entry) => entry.severity === "warning").length, issues,
  };
}

// input: { taxCategoryId, amount, priceIncludesTax, sellerRegistrationId?, placeOfSupply?, date? }.
// Returns the classification, the components with their amounts, the taxable value, the tax and the total, worked out by the engine.
export async function previewTaxCalculation(client, context, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.view, "You do not have permission to view tax configuration.");
  if (!isUuid(input.taxCategoryId)) throw new TaxError(400, "Choose a tax category.", "TAX_VALIDATION", { field: "taxCategoryId" });
  const amount = decimal(input.amount ?? 0);
  if (amount < 0n) throw new TaxError(400, "Enter an amount of zero or more.", "TAX_VALIDATION", { field: "amount" });
  const tax = await loadTaxContext(client, { organizationId: context.organizationId, sellerRegistrationId: input.sellerRegistrationId || null });
  const sellerStateCode = tax.registration?.stateCode ?? null;
  const placeOfSupply = String(input.placeOfSupply || sellerStateCode || "").trim() || null;
  const date = dayOf(input.date) ?? (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  const decision = await resolveLineTax(client, tax, { taxCategoryId: input.taxCategoryId, date, sellerStateCode, placeOfSupply, requireCategory: true });
  const computed = computeTax({ base: amount, inclusive: input.priceIncludesTax === true, components: decision.components });
  return {
    date, classification: decision.classification, categoryCode: decision.categoryCode, seller: tax.registration ? { name: tax.registration.name, stateCode: sellerStateCode } : null,
    placeOfSupply, placeOfSupplyName: gstStateName(placeOfSupply), supplyNature: decision.supplyNature, priceIncludesTax: input.priceIncludesTax === true,
    taxableAmount: asDatabaseDecimal(computed.taxableAmount), taxAmount: asDatabaseDecimal(computed.taxAmount),
    total: asDatabaseDecimal(input.priceIncludesTax === true ? amount : computed.taxableAmount + computed.taxAmount),
    components: computed.components.map((component) => ({ type: component.type, label: component.label, rate: asDatabaseDecimal(component.rate), taxAmount: asDatabaseDecimal(component.taxAmount) })),
  };
}
