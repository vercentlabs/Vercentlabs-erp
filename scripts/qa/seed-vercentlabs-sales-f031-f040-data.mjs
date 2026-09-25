#!/usr/bin/env node
// Sales F031–F040 demo data: the "Sunrise Dairy orders 20 cartons" story end
// to end — customer master with commercial defaults, addresses/contacts,
// dairy catalogue with carton units and variants, GST, price lists,
// customer-specific prices (with a scheduled successor and a correction
// kept as history) and quotations in every state through to an order.
// Everything goes through the governed Sales/business-data functions.
// Local-only, safe to run more than once (each step checks first).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  approveQuotation, convertQuotationToOrder, createBusinessDataRecord, createQuotation, createSalesPriceList,
  recordPublicQuoteDecision, reviseQuotation, scanExpiredQuotations, sendQuotation, submitQuotation,
  updateBusinessDataRecord, updateSalesSettings, upsertSalesCustomerPrice, upsertSalesPriceListItem,
} from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");
const ORG_NAME = process.env.SEED_ORG_NAME || "Vercentlabs";
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const db = new Client({ connectionString });
await db.connect();
const organizationId = (await db.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0]?.id;
if (!organizationId) throw new Error(`Organization "${ORG_NAME}" not found.`);
const companyId = (await db.query(`SELECT id FROM companies WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0].id;
const userByEmail = async (email) => (await db.query(`SELECT id FROM users WHERE email=$1`, [email])).rows[0].id;
const ownerId = await userByEmail("atharva.chavan@vercentlabs.com");
const approverId = await userByEmail("priya.nair@vercentlabs.demo");
const ALL = [
  "sales.view", "sales.quotation.create", "sales.quotation.send", "sales.quotation.approve", "sales.order.create", "sales.order.approve",
  "sales.order.confirm", "sales.settings.manage", "sales.price.override", "sales.margin.view", "sales.credit.override", "parties.manage",
];
const ctx = (userId) => ({ organizationId, userId, activeCompanyId: companyId, activeBranchId: null, allowAllCompanies: true, permissions: ALL, roleSlugs: ["organization_owner"] });
const owner = ctx(ownerId);
const approver = ctx(approverId);

async function tx(fn) {
  await db.query("BEGIN");
  try {
    await setTenantContext(db, organizationId);
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
const one = async (sql, values) => (await db.query(sql, [organizationId, ...values])).rows[0];
async function ensure(label, find, create) {
  const found = await find();
  if (found) { console.log(`present  ${label}`); return found; }
  const created = await tx(create);
  console.log(`created  ${label}`);
  return created;
}
const record = (resource, input) => (c) => createBusinessDataRecord(c, owner, resource, input);

// ---------- Settings, units, taxes, terms ----------
const net30 = await ensure("payment term Net 30", () => one(`SELECT id FROM tenant.payment_terms WHERE organization_id=$1 AND code=$2`, ["NET30"]),
  record("payment-terms", { code: "NET30", name: "Net 30", description: "Payment due 30 days from invoice", defaultDueDays: 30, status: "active" }));
const ea = await one(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code=$2`, ["EA"]);
const ctn = await ensure("unit Carton", () => one(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code=$2`, ["CTN"]),
  record("units-of-measure", { code: "CTN", name: "Carton", category: "packaging", decimalPlaces: 0, isBase: false, status: "active" }));
const taxCategory = async (code, name, rate) => {
  const category = await ensure(`tax ${name}`, () => one(`SELECT id FROM tenant.tax_categories WHERE organization_id=$1 AND code=$2`, [code]),
    record("tax-categories", { code, name, description: `${name} (CGST + SGST within the state, IGST across states)`, status: "active" }));
  await ensure(`tax rate ${name}`, () => one(`SELECT id FROM tenant.tax_rates WHERE organization_id=$1 AND tax_category_id=$2`, [category.id]),
    record("tax-rates", { taxCategoryId: category.id, name, code, taxType: "gst", rate, effectiveFrom: "2026-04-01", status: "active" }));
  return category;
};
const gst5 = await taxCategory("GST5", "GST 5%", 5);
const gst12 = await taxCategory("GST12", "GST 12%", 12);
const gst18 = await taxCategory("GST18", "GST 18%", 18);

// ---------- Products and services ----------
const item = (code, fields) => ensure(`item ${code}`, () => one(`SELECT id FROM tenant.items WHERE organization_id=$1 AND code=$2`, [code]),
  record("items", { code, uomId: ea.id, trackInventory: false, trackingType: "none", allowNegativeStock: false, valuationMethod: "standard", purchasePrice: 0, status: "active", ...fields }));
const milk = await item("MILK-TON-1L", { name: "Toned milk 1 L pouch", description: "Pasteurised toned milk, 3% fat, 1 litre pouch", itemType: "product", hsnSacCode: "0401", taxCategoryId: gst5.id, standardCost: 44, salesPrice: 56 });
const paneer = await item("PANEER-200", { name: "Fresh paneer 200 g", description: "Malai paneer block, vacuum packed", itemType: "product", hsnSacCode: "0406", taxCategoryId: gst5.id, standardCost: 68, salesPrice: 90 });
const ghee = await item("GHEE-COW", { name: "Cow ghee", description: "Pure cow ghee in tins", itemType: "product", hsnSacCode: "0405", taxCategoryId: gst12.id, standardCost: 250, salesPrice: 330 });
const coldChain = await item("SVC-COLDCHAIN", { name: "Cold-chain delivery (per trip)", description: "Refrigerated truck, up to 2 tonnes", itemType: "service", hsnSacCode: "996511", taxCategoryId: gst18.id, standardCost: 1800, salesPrice: 2500 });
for (const [product, factor] of [[milk, 12], [paneer, 20]])
  await ensure(`carton of ${factor} for ${product.id.slice(0, 8)}`, () => one(`SELECT id FROM tenant.item_uom_conversions WHERE organization_id=$1 AND item_id=$2 AND from_uom_id=$3`, [product.id, ctn.id]),
    record("item-uom-conversions", { itemId: product.id, fromUomId: ctn.id, toUomId: ea.id, conversionFactor: factor, status: "active" }));
const variant = (sku, name, salesPrice, standardCost) => ensure(`variant ${sku}`, () => one(`SELECT id FROM tenant.item_variants WHERE organization_id=$1 AND sku=$2`, [sku]),
  record("item-variants", { itemId: ghee.id, sku, name, attributes: { size: name }, salesPrice, standardCost, status: "active" }));
const ghee500 = await variant("GHEE-COW-500", "500 ml tin", 330, 250);
const ghee1l = await variant("GHEE-COW-1L", "1 L tin", 640, 480);

// ---------- Price lists ----------
const priceList = (code, name) => ensure(`price list ${code}`, () => one(`SELECT id FROM tenant.price_lists WHERE organization_id=$1 AND code=$2`, [code]),
  (c) => createSalesPriceList(c, owner, { code, name, currencyCode: "INR", taxInclusive: false, validFrom: "2026-04-01", validTo: "2027-03-31" }));
const standard = await priceList("STD-2026", "Standard price list FY 2026-27");
const distributor = await priceList("DIST-2026", "Distributor price list FY 2026-27");
const row = (list, itemId, rate, extra = {}) => tx((c) => upsertSalesPriceListItem(c, owner, { priceListId: list.id, itemId, rate, minimumQuantity: 1, ...extra }));
await row(standard, milk.id, 56);
await row(standard, milk.id, 648, { uomId: ctn.id }); // a full carton is cheaper than 12 loose pouches
await row(standard, paneer.id, 90);
await row(standard, ghee.id, 330, { variantId: ghee500.id });
await row(standard, ghee.id, 640, { variantId: ghee1l.id });
await row(standard, coldChain.id, 2500);
await row(distributor, milk.id, 52);
await row(distributor, milk.id, 50, { minimumQuantity: 240 }); // quantity break: 20+ cartons
await row(distributor, paneer.id, 84);
await row(distributor, ghee.id, 310, { variantId: ghee500.id });
await row(distributor, ghee.id, 600, { variantId: ghee1l.id });
console.log("upserted price-list rows");

await tx((c) => updateSalesSettings(c, owner, { sellerStateCode: "27", defaultQuoteValidityDays: 15, quotationApprovalDiscount: 10, minimumMarginPercent: 8, defaultPriceListId: standard.id }));
console.log("updated Sales settings");

// ---------- Customers ----------
const sunrise = await one(`SELECT id,updated_at FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2`, ["Sunrise Dairy Products"]);
await tx((c) => updateBusinessDataRecord(c, owner, "parties", sunrise.id, {
  partyType: "customer", legalName: "Sunrise Dairy Products Pvt Ltd", gstin: "27AAKCS4471M1Z5", pan: "AAKCS4471M", currencyCode: "INR",
  paymentTermId: net30.id, creditLimit: 500000, defaultPriceListId: distributor.id, taxTreatment: "registered_regular",
  defaultShippingMethod: "Refrigerated road freight", defaultDeliveryTerms: "Door delivery to the Pune plant, 6 am – 10 am", salesBlock: "none",
}));
console.log("updated Sunrise Dairy Products customer profile");
const address = (partyId, addressType, fields) => ensure(`${addressType} address ${fields.city}`,
  () => one(`SELECT id FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type=$3 AND line1=$4`, [partyId, addressType, fields.line1]),
  record("addresses", { partyId, addressType, countryCode: "IN", status: "active", ...fields }));
const contact = (partyId, firstName, lastName, fields) => ensure(`contact ${firstName} ${lastName}`,
  () => one(`SELECT id FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 AND first_name=$3 AND last_name=$4`, [partyId, firstName, lastName]),
  record("contacts", { partyId, firstName, lastName, status: "active", ...fields }));
await address(sunrise.id, "registered", { line1: "12 Marol Industrial Estate", city: "Mumbai", state: "Maharashtra", stateCode: "27", postalCode: "400059", gstin: "27AAKCS4471M1Z5", isPrimary: true });
const sunriseBilling = await address(sunrise.id, "billing", { line1: "4th Floor, Kanakia Wall Street, Andheri East", city: "Mumbai", state: "Maharashtra", stateCode: "27", postalCode: "400093", isPrimary: true });
const sunriseShipping = await address(sunrise.id, "shipping", { line1: "Gat No. 214, Chakan MIDC Phase II", city: "Pune", state: "Maharashtra", stateCode: "27", postalCode: "410501", isPrimary: true });
await address(sunrise.id, "plant", { line1: "Milk collection centre, Sinnar Road", city: "Nashik", state: "Maharashtra", stateCode: "27", postalCode: "422103", isPrimary: false });
const meera = await contact(sunrise.id, "Meera", "Kulkarni", { designation: "Purchase Manager", email: "meera.kulkarni@sunrisedairy.in", mobile: "+91 98200 41177", isPrimary: true });
await contact(sunrise.id, "Rohit", "Deshmukh", { designation: "Accounts Payable Lead", email: "ap@sunrisedairy.in", phone: "+91 22 4096 1200", isPrimary: false });

const customer = async (code, displayName, fields, addr, person) => {
  const party = await ensure(`customer ${displayName}`, () => one(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND code=$2`, [code]),
    record("parties", { code, displayName, partyType: "customer", currencyCode: "INR", paymentTermId: net30.id, status: "active", ...fields }));
  await address(party.id, "billing", { ...addr, isPrimary: true });
  await address(party.id, "shipping", { ...addr, line1: `Warehouse — ${addr.line1}`, isPrimary: true });
  await contact(party.id, ...person);
  return party;
};
const greenfield = await customer("CUST-GREENFIELD", "Greenfield Foods", { legalName: "Greenfield Foods Pvt Ltd", gstin: "29AAGCG7781K1Z2", creditLimit: 200000, taxTreatment: "registered_regular", defaultShippingMethod: "Road freight", salesBlock: "orders", salesBlockReason: "Invoices overdue beyond 90 days — cleared by finance only" },
  { line1: "88 Peenya 2nd Stage", city: "Bengaluru", state: "Karnataka", stateCode: "29", postalCode: "560058" }, ["Arjun", "Hegde", { designation: "Category Buyer", email: "arjun.hegde@greenfieldfoods.in", mobile: "+91 99001 23456", isPrimary: true }]);
await customer("CUST-GULFFRESH", "Gulf Fresh Trading", { legalName: "Gulf Fresh Trading LLC", creditLimit: 0, taxTreatment: "overseas", defaultShippingMethod: "Reefer container by sea", defaultIncoterm: "CIF Jebel Ali" },
  { line1: "Warehouse 7, Al Quoz Industrial Area 3", city: "Dubai", state: "Dubai", stateCode: "", postalCode: "00000", countryCode: "AE" }, ["Fatima", "Al Mansoori", { designation: "Procurement Head", email: "fatima@gulffresh.ae", mobile: "+971 50 123 4567", isPrimary: true }]);

// ---------- Customer-specific prices ----------
const hasRule = (itemId, rate, status = "active") => one(`SELECT id FROM tenant.sales_pricing_rules WHERE organization_id=$1 AND party_id=$2 AND item_id=$3 AND adjustment_value=$4 AND status=$5`, [sunrise.id, itemId, rate, status]);
await ensure("Sunrise paneer contract price 82", () => hasRule(paneer.id, 82, "inactive").then((r) => r || hasRule(paneer.id, 82)),
  (c) => upsertSalesCustomerPrice(c, owner, { partyId: sunrise.id, itemId: paneer.id, fixedRate: 82, validFrom: "2026-04-01", reason: "Annual supply contract FY 2026-27, 5,000 blocks a month" }));
await ensure("Sunrise paneer successor price 86 from 1 Jan 2027", () => hasRule(paneer.id, 86),
  (c) => upsertSalesCustomerPrice(c, owner, { partyId: sunrise.id, itemId: paneer.id, fixedRate: 86, validFrom: "2027-01-01", reason: "Milk procurement cost up 4% — revision agreed with Meera Kulkarni" }));
await ensure("Sunrise milk price 51 (later corrected)", () => hasRule(milk.id, 51, "inactive").then((r) => r || hasRule(milk.id, 51)),
  (c) => upsertSalesCustomerPrice(c, owner, { partyId: sunrise.id, itemId: milk.id, fixedRate: 51, validFrom: "2026-09-01", reason: "Volume commitment of 2,000 cartons a month" }));
await ensure("Sunrise milk price corrected to 50", () => hasRule(milk.id, 50),
  (c) => upsertSalesCustomerPrice(c, owner, { partyId: sunrise.id, itemId: milk.id, fixedRate: 50, validFrom: "2026-09-01", reason: "Corrected: contract says ₹50 a pouch, not ₹51" }));

// ---------- Quotations ----------
const header = { companyId, partyId: sunrise.id, ownerUserId: ownerId, contactId: meera.id, billingAddressId: sunriseBilling.id, shippingAddressId: sunriseShipping.id, currencyCode: "INR", paymentTermId: net30.id, shippingMethod: "Refrigerated road freight", deliveryTerms: "Door delivery to the Pune plant, 6 am – 10 am", supplyType: "domestic" };
const cartons = (quantity, extra = {}) => ({ itemId: milk.id, uomId: ctn.id, quantity, ...extra });
const quote = (note, build) => ensure(`quotation "${note}"`,
  () => one(`SELECT q.id FROM tenant.sales_quotations q JOIN tenant.sales_quotation_versions v ON v.quotation_id=q.id WHERE q.organization_id=$1 AND v.customer_notes=$2 LIMIT 1`, [note]),
  build);
const idem = (note) => createHash("sha256").update(`f031-f040:${note}`).digest("hex").slice(0, 32);
const create = (c, note, extra) => createQuotation(c, owner, { ...header, validUntil: iso(15), customerNotes: note, idempotencyKey: idem(note), ...extra });
const versionOf = async (id) => (await db.query(`SELECT current_version_id FROM tenant.sales_quotations WHERE id=$1`, [id])).rows[0].current_version_id;

await quote("20 cartons of toned milk for the Pune plant, weekly delivery", (c) =>
  create(c, "20 cartons of toned milk for the Pune plant, weekly delivery", { headerDiscountPercent: 2, lines: [cartons(20), { itemId: paneer.id, uomId: ctn.id, quantity: 5 }] }));

await quote("Festive season ghee and paneer — special pricing requested", async (c) => {
  const q = await create(c, "Festive season ghee and paneer — special pricing requested", { lines: [{ itemId: ghee.id, variantId: ghee1l.id, quantity: 120, discountPercent: 12 }, { itemId: paneer.id, quantity: 400 }] });
  await submitQuotation(c, owner, q.id, approverId);
  return q;
});

await quote("Monthly milk supply for October — approved rates", async (c) => {
  const q = await create(c, "Monthly milk supply for October — approved rates", { lines: [cartons(40), { itemId: coldChain.id, quantity: 4 }] });
  await submitQuotation(c, owner, q.id, approverId);
  const { rows } = await c.query(`SELECT lifecycle_status FROM tenant.sales_quotations WHERE id=$1`, [q.id]);
  if (rows[0].lifecycle_status === "pending_approval") await approveQuotation(c, approver, q.id, q.currentVersionId);
  await sendQuotation(c, owner, q.id);
  return q;
});

await quote("Paneer for the new Nashik outlet — revised volumes", async (c) => {
  const q = await create(c, "Paneer for the new Nashik outlet — revised volumes", { lines: [{ itemId: paneer.id, uomId: ctn.id, quantity: 10 }] });
  await reviseQuotation(c, owner, q.id, { ...header, validUntil: iso(20), customerNotes: "Paneer for the new Nashik outlet — revised volumes", revisionReason: "Meera asked for 15 cartons instead of 10 and delivery on Mondays", lines: [{ itemId: paneer.id, uomId: ctn.id, quantity: 15 }] });
  return q;
});

await quote("Standing order: 20 cartons of milk every Monday", async (c) => {
  const q = await create(c, "Standing order: 20 cartons of milk every Monday", { lines: [cartons(20)] });
  await submitQuotation(c, owner, q.id, approverId);
  const { rows } = await c.query(`SELECT lifecycle_status FROM tenant.sales_quotations WHERE id=$1`, [q.id]);
  if (rows[0].lifecycle_status === "pending_approval") await approveQuotation(c, approver, q.id, q.currentVersionId);
  const sent = await sendQuotation(c, owner, q.id);
  const tokenHash = createHash("sha256").update(sent.token).digest("hex");
  await recordPublicQuoteDecision(c, { organizationId }, tokenHash, { decision: "accepted", customerName: "Meera Kulkarni", customerEmail: "meera.kulkarni@sunrisedairy.in", customerTitle: "Purchase Manager", typedSignature: "Meera Kulkarni", note: "Approved. Please start from next Monday." });
  await convertQuotationToOrder(c, owner, q.id);
  return q;
});

// An offer to a Karnataka customer (IGST) that is about to expire.
await quote("Trial order for Bengaluru stores — IGST applies", async (c) => {
  const gfBilling = await one(`SELECT id FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type='billing'`, [greenfield.id]);
  const gfShipping = await one(`SELECT id FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type='shipping'`, [greenfield.id]);
  const q = await createQuotation(c, owner, { companyId, partyId: greenfield.id, ownerUserId: ownerId, billingAddressId: gfBilling.id, shippingAddressId: gfShipping.id, currencyCode: "INR", paymentTermId: net30.id, validUntil: iso(3), customerNotes: "Trial order for Bengaluru stores — IGST applies", shippingMethod: "Road freight", supplyType: "domestic", idempotencyKey: idem("greenfield"), lines: [cartons(10), { itemId: ghee.id, variantId: ghee500.id, quantity: 48 }] });
  await submitQuotation(c, owner, q.id, approverId);
  const { rows } = await c.query(`SELECT lifecycle_status FROM tenant.sales_quotations WHERE id=$1`, [q.id]);
  if (rows[0].lifecycle_status === "pending_approval") await approveQuotation(c, approver, q.id, q.currentVersionId);
  await sendQuotation(c, owner, q.id);
  return q;
});

// Expired offer: the only non-governed step in this script. Validity cannot be
// set in the past through the app (by design, F036), so the demo moves one
// sent quotation's valid-until back, then the governed expiry scan expires it.
const lapsed = await quote("Summer curd promotion — offer lapsed", async (c) => {
  const q = await create(c, "Summer curd promotion — offer lapsed", { lines: [{ itemId: paneer.id, quantity: 200 }] });
  await submitQuotation(c, owner, q.id, approverId);
  const { rows } = await c.query(`SELECT lifecycle_status FROM tenant.sales_quotations WHERE id=$1`, [q.id]);
  if (rows[0].lifecycle_status === "pending_approval") await approveQuotation(c, approver, q.id, q.currentVersionId);
  await sendQuotation(c, owner, q.id);
  return q;
});
await tx(async (c) => {
  await c.query(`UPDATE tenant.sales_quotations SET valid_until=$3 WHERE organization_id=$1 AND id=$2 AND lifecycle_status IN ('approved','sent','viewed')`, [organizationId, lapsed.id, iso(-5)]);
  const result = await scanExpiredQuotations(c, owner);
  console.log(`expiry scan: ${result.expired} expired`);
});

await db.end();
console.log("done");
