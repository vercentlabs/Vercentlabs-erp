import assert from "node:assert/strict";
import test from "node:test";

import { createQuotation, previewSalesDocument, reviseQuotation, SalesError, sendQuotation } from "../src/modules/sales/index.js";
import { upsertSalesCustomerPrice } from "../src/modules/sales/pass1-operations.js";

const org = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const partyId = "33333333-3333-4333-8333-333333333333";
const otherPartyId = "99999999-9999-4999-8999-999999999999";
const itemId = "44444444-4444-4444-8444-444444444444";
const uomId = "55555555-5555-4555-8555-555555555555";
const boxUomId = "77777777-7777-4777-8777-777777777777";
const userId = "66666666-6666-4666-8666-666666666666";
const priceListId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const addressId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const contactId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const quotationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const context = {
  organizationId: org,
  userId,
  activeCompanyId: companyId,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.price.override", "sales.quotation.create", "sales.quotation.send", "sales.settings.manage"],
  roleSlugs: [],
};

function input(overrides = {}, line = {}) {
  return { companyId, partyId, ownerUserId: userId, currencyCode: "INR", lines: [{ itemId, quantity: "10", ...line }], ...overrides };
}

// Mock client in the style of sales-line-variant-uom-f033.test.mjs, with
// knobs for each F031–F040 branch. `calls` records every SQL statement.
function client(o = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM public.companies")) return { rows: [{ id: companyId, name: "Acme", base_currency: "INR", country_code: "IN" }] };
      if (sql.includes("FROM tenant.business_parties WHERE organization_id=$1 AND id=$2"))
        return { rows: [{ id: partyId, company_id: companyId, party_type: "customer", display_name: "Sunrise Dairy", status: "active", payment_term_id: null, credit_limit: "0", sales_block: "none", ...o.party }] };
      if (sql.includes("FROM public.organization_memberships membership") && sql.includes("users.id")) return { rows: [{ id: userId, full_name: "Owner" }] };
      if (sql.includes("FROM tenant.contacts WHERE")) return { rows: o.contact ? [o.contact] : [] };
      if (sql.includes("FROM tenant.addresses WHERE")) return { rows: o.address ? [o.address] : [] };
      if (sql.includes("FROM tenant.currencies WHERE organization_id=$1 AND code=$2")) return { rows: [{ code: "INR", decimal_places: 2, status: "active" }] };
      if (sql.includes("SELECT default_price_list_id FROM tenant.sales_settings")) return { rows: [{ default_price_list_id: o.settingsPriceListId ?? null }] };
      if (sql.includes("FROM tenant.sales_settings")) return { rows: [{ seller_state_code: o.sellerState ?? "27" }] };
      if (sql.includes("FROM tenant.price_lists WHERE")) return { rows: o.priceList ? [o.priceList] : [] };
      if (sql.includes("FROM tenant.items item"))
        return { rows: [{ id: itemId, company_id: companyId, code: "MILK-CTN", name: "Milk carton", description: "", hsn_sac_code: "0401", uom_id: uomId, standard_cost: "40", sales_price: "100", tax_category_id: o.taxCategoryId ?? null, uom_code: "EA", uom_name: "Each" }] };
      if (sql.includes("FROM tenant.item_uom_conversions conversion")) return { rows: o.conversion ? [o.conversion] : [] };
      if (sql.includes("FROM tenant.price_list_items")) return { rows: o.priceRow ? [o.priceRow] : [] };
      if (sql.includes("FROM tenant.sales_pricing_rules WHERE organization_id=$1 AND status='active'")) return { rows: o.rules ?? [] };
      if (sql.includes("FROM tenant.tax_rates")) return { rows: o.taxRate ? [o.taxRate] : [] };
      if (sql.includes("FROM tenant.sales_quotations WHERE organization_id=$1 AND id=$2 FOR UPDATE")) return { rows: [o.quote] };
      if (sql.includes("FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active'")) return { rows: [{ id: itemId, company_id: companyId, standard_cost: "40" }] };
      if (sql.includes("SELECT id,company_id,display_name FROM tenant.business_parties")) return { rows: [{ id: partyId, company_id: companyId, display_name: "Sunrise Dairy" }] };
      if (sql.includes("SELECT id,code FROM tenant.sales_pricing_rules")) return { rows: o.existingRule ? [o.existingRule] : [] };
      if (sql.includes("INSERT INTO tenant.sales_pricing_rules")) return { rows: [{ id: "new-rule" }] };
      return { rows: [] };
    },
  };
}

const rejectsWith = (code) => (error) => error instanceof SalesError && error.code === code;

test("F033: a base-unit price is scaled when selling in an alternate unit (2 boxes of 12 = 24 units)", async () => {
  const preview = await previewSalesDocument(client({ conversion: { conversion_factor: "12", uom_code: "BOX" } }), context, input({}, { uomId: boxUomId, quantity: "2" }));
  assert.equal(preview.lines[0].unitPrice, "1200.000000");
  assert.equal(preview.totals.subtotal, "2400.000000");
  assert.equal(preview.totals.costTotal, "960.000000");
});

test("F033/F035: a customer fixed price is per base unit, so 1 carton of 12 at 50 a pouch is 600", async () => {
  const c = client({ conversion: { conversion_factor: "12", uom_code: "CTN" }, rules: [{ id: "rule-1", code: "CUST-1", adjustment_type: "fixed_rate", adjustment_value: "50" }] });
  const preview = await previewSalesDocument(c, context, input({}, { uomId: boxUomId, quantity: "20" }));
  assert.equal(preview.lines[0].unitPrice, "600.000000");
  assert.equal(preview.totals.subtotal, "12000.000000");
});

test("F034: a base-unit price-list row is scaled too, and the lookup is variant-aware", async () => {
  const c = client({ conversion: { conversion_factor: "12", uom_code: "BOX" }, priceList: { id: priceListId, code: "WHOLESALE", name: "Wholesale", currency_code: "INR", tax_inclusive: false }, priceRow: { id: "row-1", rate: "90", uom_id: null } });
  const preview = await previewSalesDocument(c, context, input({ priceListId }, { uomId: boxUomId, quantity: "1" }));
  assert.equal(preview.lines[0].unitPrice, "1080.000000");
  const lookup = c.calls.find((call) => call.sql.includes("FROM tenant.price_list_items"));
  assert.match(lookup.sql, /variant_id IS NULL OR variant_id IS NOT DISTINCT FROM \$6/);
  // A unit-specific row must outrank the base-unit row: "(uom_id=$4) DESC"
  // sorted the base row's NULL first, so the carton rate was never used.
  assert.match(lookup.sql, /\(uom_id IS NOT DISTINCT FROM \$4\) DESC/);
});

test("F031/F034: with no price list chosen, the customer's default price list applies", async () => {
  const c = client({ party: { default_price_list_id: priceListId }, priceList: { id: priceListId, code: "SUNRISE", name: "Sunrise contract", currency_code: "INR", tax_inclusive: false }, priceRow: { id: "row-2", rate: "95", uom_id: uomId } });
  const preview = await previewSalesDocument(c, context, input());
  assert.equal(preview.lines[0].unitPrice, "95.000000");
  assert.equal(preview.master.priceList.id, priceListId);
});

test("F031: a customer blocked for all sales cannot get a quotation; an orders-only block still allows one", async () => {
  await assert.rejects(previewSalesDocument(client({ party: { sales_block: "all", sales_block_reason: "Payments overdue" } }), context, input()), rejectsWith("SALES_CUSTOMER_BLOCKED"));
  const preview = await previewSalesDocument(client({ party: { sales_block: "orders", sales_block_reason: "Credit review" } }), context, input());
  assert.equal(preview.lines.length, 1);
  await assert.rejects(previewSalesDocument(client({ party: { sales_block: "orders", sales_block_reason: "Credit review" } }), context, input(), { order: true }), rejectsWith("SALES_CUSTOMER_BLOCKED"));
});

test("F032: a plant address cannot be the bill-to; an anonymized contact cannot be used", async () => {
  const plant = { id: addressId, address_type: "plant", line1: "Plot 4", state_code: "27" };
  await assert.rejects(previewSalesDocument(client({ address: plant }), context, input({ billingAddressId: addressId })), rejectsWith("SALES_ADDRESS_PURPOSE_MISMATCH"));
  const preview = await previewSalesDocument(client({ address: plant }), context, input({ shippingAddressId: addressId }));
  assert.equal(preview.lines.length, 1);
  const erased = { id: contactId, first_name: "Asha", privacy_status: "anonymized", archived_at: null };
  await assert.rejects(previewSalesDocument(client({ contact: erased }), context, input({ contactId })), rejectsWith("SALES_CONTACT_NOT_USABLE"));
});

test("F039/F040: the header discount lowers the taxable value before GST is charged", async () => {
  const c = client({ taxCategoryId: "tax-cat", taxRate: { tax_type: "gst", rate: "18", name: "GST 18%", code: "GST18" } });
  const preview = await previewSalesDocument(c, context, input({ headerDiscountPercent: "10", placeOfSupply: "27" }));
  assert.equal(preview.totals.subtotal, "1000.000000");
  assert.equal(preview.totals.headerDiscountAmount, "100.000000");
  assert.equal(preview.totals.taxTotal, "162.000000");
  assert.equal(preview.totals.grandTotal, "1062.000000");
  assert.deepEqual(preview.lines[0].taxLines.map((l) => l.taxType), ["cgst", "sgst"]);
});

test("F040: GST is never guessed as IGST when the place of supply is unknown", async () => {
  const c = client({ taxCategoryId: "tax-cat", taxRate: { tax_type: "gst", rate: "18", name: "GST 18%", code: "GST18" } });
  await assert.rejects(previewSalesDocument(c, context, input()), rejectsWith("SALES_PLACE_OF_SUPPLY_REQUIRED"));
});

test("F036: a quotation cannot be created with a validity date in the past", async () => {
  await assert.rejects(createQuotation(client(), context, input({ validUntil: "2020-01-01" })), rejectsWith("SALES_QUOTATION_VALIDITY_PAST"));
});

test("F037: a revision needs a reason and cannot switch the customer", async () => {
  const quote = { id: quotationId, party_id: otherPartyId, lifecycle_status: "sent" };
  await assert.rejects(reviseQuotation(client({ quote }), context, quotationId, input()), rejectsWith("SALES_QUOTATION_REVISION_REASON_REQUIRED"));
  await assert.rejects(reviseQuotation(client({ quote }), context, quotationId, input({ revisionReason: "Customer asked for 5% more volume" })), rejectsWith("SALES_QUOTATION_CUSTOMER_LOCKED"));
});

test("F038: an expired quotation cannot be sent", async () => {
  const quote = { id: quotationId, lifecycle_status: "approved", valid_until: "2020-01-01", current_version_id: "v1" };
  await assert.rejects(sendQuotation(client({ quote }), context, quotationId), rejectsWith("SALES_QUOTATION_EXPIRED"));
});

test("F035: a price below standard cost needs the price-override right", async () => {
  const noOverride = { ...context, permissions: ["sales.settings.manage"] };
  await assert.rejects(upsertSalesCustomerPrice(client(), noOverride, { partyId, itemId, fixedRate: 30, reason: "Annual contract" }), rejectsWith("SALES_CUSTOMER_PRICE_BELOW_COST"));
});

test("F035: correcting a price retires the old row instead of overwriting it; a later start date schedules a successor", async () => {
  const correction = client({ existingRule: { id: "old-rule", code: "CUST-1" } });
  await upsertSalesCustomerPrice(correction, context, { partyId, itemId, fixedRate: 95, reason: "Corrected contract rate" });
  assert.ok(!correction.calls.some((call) => /SET company_id=\$3,name=\$4,adjustment_value/.test(call.sql)), "no in-place overwrite");
  const retire = correction.calls.find((call) => call.sql.includes("superseded_by_id=$3"));
  assert.deepEqual(retire.values.slice(1, 3), ["old-rule", "new-rule"]);

  const scheduled = client();
  await upsertSalesCustomerPrice(scheduled, context, { partyId, itemId, fixedRate: 98, validFrom: "2027-01-01", reason: "2027 contract" });
  const endCurrent = scheduled.calls.find((call) => call.sql.includes("SET valid_to=($6::date - 1)"));
  assert.equal(endCurrent.values[5], "2027-01-01");
});
