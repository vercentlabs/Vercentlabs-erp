// GST MVP 41 (the tax engine's safeguards and the GSTR-1 working paper): CGST + SGST within a state, IGST across states, CGST + UTGST in a
// Union Territory, cess on top, tax backed out of an inclusive price, the rate in force on the document date (never today's), exempt and
// non-GST supplies charging nothing yet reported apart, a composition registration charging no GST; GSTR-1 collects the posted documents of
// one GSTIN and month into B2B / B2CL / B2CS / CDNR / nil-rated / HSN / documents-issued, blocks on bad documents, reconciles with Finance's
// tax ledger, is approved by someone other than its preparer (refused when documents changed), exported as working data and recorded as
// filed — after which a reversed document is flagged as an amendment, and a document is never reported twice.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:gst-returns     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(`file:///${ROOT}services/api/src/${path}`);

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the GST suite on the live database. Set SMOKE_DATABASE to a scratch database.");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();

let passed = 0;
const failures = [];
async function check(name, work) {
  await client.query("SAVEPOINT smoke_check");
  try {
    await work();
    await client.query("RELEASE SAVEPOINT smoke_check");
    passed += 1;
    console.log("  ok   ", name);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT smoke_check");
    failures.push(name);
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 5).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function refused(work, code) {
  await client.query("SAVEPOINT refused");
  try { await work(); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT refused"); if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  await client.query("RELEASE SAVEPOINT refused");
  throw new Error(`expected rejection ${code ?? ""}`);
}
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstin(state, pan, entity = "1") {
  const base = `${state}${pan}${entity}Z`;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) { const p = CHARS.indexOf(base[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  return base + CHARS[(36 - (sum % 36)) % 36];
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const tag = Math.random().toString(16).slice(2, 10);
  const registered = await registerOrganization(client, {
    fullName: "Smoke Owner", email: `gst-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `GST ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const organizationId = registered.organizationId;
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
  async function contextFor(userId) {
    const { rows } = await client.query(
      `SELECT COALESCE(array_agg(DISTINCT role.slug), ARRAY[]::text[]) AS role_slugs,
              COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
         LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
        WHERE assignment.organization_id = $1 AND assignment.user_id = $2`, [organizationId, userId]);
    return { organizationId, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions };
  }
  async function addMember(roleSlug, name) {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status) VALUES (gen_random_uuid(), $1, $2, 'x', 'active') RETURNING id`,
      [`${name.split(" ")[0].toLowerCase()}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [organizationId, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`,
      [organizationId, id, roleSlug]);
    return contextFor(id);
  }
  const owner = await contextFor(registered.userId);
  const preparer = await addMember("accountant", "Priya Accountant");
  const approver = await addMember("finance_manager", "Farhan Finance");
  const auditor = await addMember("auditor", "Anand Auditor");
  const seller = await addMember("sales_representative", "Om Outsider");
  const accounting = await api("modules/accounting/index.js");
  const tax = await api("core/tax/index.js");
  const gst = await api("modules/gst/index.js");

  const OWN = gstin("27", "AAPFU0939F");
  const reg = (await client.query(`INSERT INTO tenant.tax_registrations (organization_id, code, name, legal_name, registration_number, country_code, state_code, state_name, is_default, status, registration_type, valid_from)
    VALUES ($1, 'MH', 'Maharashtra', 'GST Smoke Pvt Ltd', $2, 'IN', '27', 'Maharashtra', true, 'active', 'regular', '2017-07-01') RETURNING *`, [organizationId, OWN])).rows[0];
  await client.query(`UPDATE tenant.tax_registrations SET is_default = false WHERE organization_id = $1 AND id <> $2`, [organizationId, reg.id]);
  await client.query(`UPDATE tenant.tax_registrations SET status = 'inactive' WHERE organization_id = $1 AND id <> $2`, [organizationId, reg.id]);
  const party = async (name) => (await client.query(`INSERT INTO tenant.business_parties (organization_id, code, party_type, display_name, legal_name, currency_code, status)
    VALUES ($1, $2, 'customer', $3, $3, 'INR', 'active') RETURNING id`, [organizationId, `C-${name.slice(0, 4).toUpperCase()}-${tag.slice(0, 4)}`, name])).rows[0].id;
  const pune = await party("Pune Traders");
  const blr = await party("Bengaluru Retail");
  const walkin = await party("Walk-in Customers");
  const PUNE = gstin("27", "AABCP1234C");
  const BLR = gstin("29", "AABCB5678D");
  const revenue = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code = '4100'", [organizationId])).rows[0].id;
  const g = (type, taxable, amount, rate) => ({ taxType: type, taxableAmount: String(taxable), taxAmount: String(amount), rate });
  const post = async ({ partyId, date, lines, gstinOf = null, pos, supplyType = "domestic", invoiceType = "invoice", sourceInvoiceId = null, name = "Customer" }) => {
    const created = await accounting.createCustomerInvoice(client, owner, {
      partyId, invoiceDate: date, dueDate: date, placeOfSupply: pos, supplyType, invoiceType, sourceInvoiceId,
      customerSnapshot: { id: partyId, displayName: name, legalName: name, gstin: gstinOf },
      lines: lines.map((l) => ({ description: l.description ?? "Goods", quantity: l.quantity ?? 1, unitPrice: String(l.net), taxAmount: String(l.tax ?? 0), taxDetails: l.details ?? [],
        hsnSacCode: l.hsn === undefined ? "84713010" : l.hsn, accountId: revenue })),
    });
    const id = created.id ?? created.invoice?.id;
    await client.query("UPDATE tenant.accounting_customer_invoices SET status = 'approved' WHERE organization_id = $1 AND id = $2", [organizationId, id]);
    await accounting.postCustomerInvoice(client, owner, id);
    return id;
  };

  await check("G1. The engine: CGST + SGST within a state, IGST across, CGST + UTGST in a Union Territory, cess on top, an inclusive ₹1,180 is ₹1,000 + ₹180, the rate in force on the document date, exempt and composition charge nothing", async () => {
    const cat = (await client.query(`INSERT INTO tenant.tax_categories (organization_id, code, name, status, tax_type, treatment, applies_to, country_code) VALUES ($1, 'GST-STD', 'Standard', 'active', 'gst', 'taxable', 'all', 'IN') RETURNING id`, [organizationId])).rows[0].id;
    await client.query(`INSERT INTO tenant.tax_rates (organization_id, tax_category_id, name, code, tax_type, rate, effective_from, effective_to, status, cess_rate, version) VALUES
      ($1, $2, 'GST 12%', 'G12', 'gst', 12, '2017-07-01', '2026-09-30', 'active', 0, 1), ($1, $2, 'GST 18% + cess', 'G18', 'gst', 18, '2026-10-01', NULL, 'active', 1, 2)`, [organizationId, cat]);
    const ctx = { organizationId, enabled: true, registration: { registrationType: "regular" } };
    const sep = await tax.resolveLineTax(client, ctx, { taxCategoryId: cat, date: "2026-09-15", sellerStateCode: "27", placeOfSupply: "27" });
    const oct = await tax.resolveLineTax(client, ctx, { taxCategoryId: cat, date: "2026-10-15", sellerStateCode: "27", placeOfSupply: "29" });
    const ut = await tax.resolveLineTax(client, ctx, { taxCategoryId: cat, date: "2026-09-15", sellerStateCode: "04", placeOfSupply: "04" });
    assert(sep.components.map((x) => x.type).join() === "cgst,sgst" && sep.rateId !== oct.rateId && sep.components[0].label === "CGST", sep.components.map((x) => x.type).join());
    assert(oct.components.map((x) => x.type).join() === "igst,cess", oct.components.map((x) => x.type).join());
    assert(ut.components.map((x) => x.type).join() === "cgst,utgst", ut.components.map((x) => x.type).join());
    const igst18 = [{ type: "igst", rate: 18n * 10n ** 18n }];
    const parts = await tax.resolveLineTax(client, ctx, { taxCategoryId: cat, date: "2026-10-15", sellerStateCode: "27", placeOfSupply: "27" });
    const inclusive = tax.computeTax({ base: "1180", inclusive: true, components: parts.components.filter((x) => x.type !== "cess") });
    assert(String(inclusive.taxableAmount) === String(tax.computeTax({ base: "1000", components: [] }).taxableAmount) && inclusive.components.every((x) => String(x.taxAmount) === String(inclusive.components[0].taxAmount)), "₹1,000 + ₹90 + ₹90");
    const exclusive = tax.computeTax({ base: "10000", components: parts.components.filter((x) => x.type !== "cess") });
    assert(String(exclusive.taxAmount) === String(tax.computeTax({ base: "1800", components: [] }).taxableAmount), "₹10,000 → ₹1,800");
    void igst18;
    const exempt = await tax.resolveLineTax(client, ctx, { taxCategoryId: cat, date: "2026-09-15", sellerStateCode: "27", placeOfSupply: "27", supplyType: "exempt" });
    assert(exempt.components.length === 0 && exempt.classification === "exempt", exempt.classification);
    const composition = await tax.resolveLineTax(client, { ...ctx, registration: { registrationType: "composition" } }, { taxCategoryId: cat, date: "2026-09-15", sellerStateCode: "27", placeOfSupply: "27" });
    assert(composition.components.length === 0 && composition.composition, "a composition dealer collects no GST");
    await refused(() => tax.resolveLineTax(client, { ...ctx, registration: { registrationType: "casual_taxable", name: "Casual" } }, { taxCategoryId: cat, date: "2026-09-15", sellerStateCode: "27", placeOfSupply: "27" }), "TAX_REGIME_UNSUPPORTED");
    await refused(() => tax.resolveLineTax(client, ctx, { taxCategoryId: cat, date: "2017-01-01", sellerStateCode: "27", placeOfSupply: "27" }), "TAX_RATE_MISSING");
  });

  let inv1;
  let inv2;
  let bad;
  await check("G2. September's documents: B2B intra (₹10,000 + ₹900 + ₹900), B2B inter (IGST), B2C large inter-state, B2C small, an exempt supply, a credit note, and a bad invoice — GSTR-1 sorts them, and the bad one blocks approval", async () => {
    inv1 = await post({ partyId: pune, date: "2026-09-05", gstinOf: PUNE, pos: "27", name: "Pune Traders", lines: [{ net: 10000, tax: 1800, details: [g("cgst", 10000, 900, 9), g("sgst", 10000, 900, 9)] }] });
    inv2 = await post({ partyId: blr, date: "2026-09-06", gstinOf: BLR, pos: "29", name: "Bengaluru Retail", lines: [{ net: 10000, tax: 1800, details: [g("igst", 10000, 1800, 18)] }] });
    await post({ partyId: walkin, date: "2026-09-07", pos: "07", lines: [{ net: 200000, tax: 36000, details: [g("igst", 200000, 36000, 18)] }] });
    await post({ partyId: walkin, date: "2026-09-08", pos: "27", lines: [{ net: 1000, tax: 50, details: [g("cgst", 1000, 25, 2.5), g("sgst", 1000, 25, 2.5)], hsn: "0402" }] });
    await post({ partyId: pune, date: "2026-09-09", gstinOf: PUNE, pos: "27", supplyType: "exempt", lines: [{ net: 5000, hsn: "0701" }] });
    await post({ partyId: pune, date: "2026-09-20", gstinOf: PUNE, pos: "27", invoiceType: "credit_note", sourceInvoiceId: inv1, lines: [{ net: 1000, tax: 180, details: [g("cgst", 1000, 90, 9), g("sgst", 1000, 90, 9)] }] });
    bad = await post({ partyId: pune, date: "2026-09-21", gstinOf: "27AAPFU0939F1ZX", pos: "27", lines: [{ net: 100, tax: 18, details: [g("cgst", 100, 9, 9), g("sgst", 100, 9, 9)], hsn: null }] });
    await refused(() => gst.prepareGstr1(client, seller, { registrationId: reg.id, period: "2026-09" }), "GST_FORBIDDEN");
    await refused(() => gst.prepareGstr1(client, auditor, { registrationId: reg.id, period: "2026-09" }), "GST_FORBIDDEN");
    const r = await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" });
    const s = r.summary.sections;
    assert(s.b2b.documents === 3 && s.b2cl.documents === 1 && s.b2cs.documents === 1 && s.cdnr.documents === 1 && s.nil.documents === 1, JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.documents]))));
    assert(s.b2cl.igst === 36000 && s.cdnr.cgst === -90 && r.summary.nil.intra_b2b.exempt === 5000, JSON.stringify([s.b2cl, s.cdnr, r.summary.nil]));
    const full = await gst.getGstReturn(client, auditor, r.id);
    const codes = full.exceptions.filter((x) => x.severity === "blocking").map((x) => x.code).sort();
    assert(codes.join() === "GSTIN_INVALID,HSN_MISSING", codes.join());
    await refused(() => gst.approveGstReturn(client, approver, r.id), "GST_RETURN_BLOCKED");
  });

  let ret;
  await check("G3. Reversing the bad invoice clears its exceptions (counted as cancelled in Table 13); the tax agrees with Finance's tax ledger and the GL; the preparer can't approve; a document posted after preparing makes approval stale", async () => {
    await accounting.reverseCustomerInvoice(client, owner, bad, { reason: "Wrong GSTIN and no HSN" });
    ret = await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" });
    assert(ret.summary.exceptions.blocking === 0, JSON.stringify(ret.summary.exceptions));
    const invoices = ret.summary.docs.find((d) => d.nature === "Invoices for outward supply");
    assert(invoices && invoices.cancelled === 1 && invoices.total === 6, JSON.stringify(ret.summary.docs));
    assert(ret.reconciliation.ledgerAgrees === true && ret.reconciliation.glAgrees === true, JSON.stringify(ret.reconciliation));
    assert(ret.summary.liability.taxable === 10000 + 10000 + 200000 + 1000 - 1000 && ret.summary.liability.igst === 1800 + 36000, JSON.stringify(ret.summary.liability));
    const own = await gst.prepareGstr1(client, approver, { registrationId: reg.id, period: "2026-09" });
    await refused(() => gst.approveGstReturn(client, approver, own.id), "GST_SELF_APPROVAL");
    await refused(() => gst.approveGstReturn(client, preparer, own.id), "GST_FORBIDDEN");
    ret = await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" });
    await post({ partyId: blr, date: "2026-09-25", gstinOf: BLR, pos: "29", name: "Bengaluru Retail", lines: [{ net: 2000, tax: 360, details: [g("igst", 2000, 360, 18)] }] });
    await refused(() => gst.approveGstReturn(client, approver, ret.id), "GST_RETURN_STALE");
    ret = await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" });
    assert(ret.summary.sections.b2b.documents === 3, String(ret.summary.sections.b2b.documents));
  });

  await check("G4. Warnings (e-invoice not recorded) are waived with a reason, a blocking one never; approved by the finance manager; exported as working data (B2B, B2CS aggregated, CDNR as C, HSN, Table 13); filed with the ARN, after which it is final", async () => {
    await client.query(`UPDATE tenant.tax_registrations SET einvoice_applicable = true, einvoice_applicable_from = '2026-04-01' WHERE id = $1`, [reg.id]);
    ret = await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" });
    const full = await gst.getGstReturn(client, preparer, ret.id, { section: "b2b" });
    const warn = full.exceptions.find((x) => x.code === "EINVOICE_MISSING");
    assert(warn && full.rows.length === 3, JSON.stringify(full.exceptions.map((x) => x.code)));
    await refused(() => gst.waiveGstException(client, preparer, warn.id, {}), "GST_REASON_REQUIRED");
    await gst.waiveGstException(client, preparer, warn.id, { note: "IRN generated on the IRP portal; reference to be captured" });
    const again = await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" });
    const kept = (await gst.getGstReturn(client, preparer, again.id)).exceptions.find((x) => x.id === warn.id);
    assert(kept?.status === "waived", "a waiver survives preparing again");
    ret = await gst.approveGstReturn(client, approver, again.id);
    assert(ret.status === "APPROVED" && /not filed/.test(ret.label), ret.label);
    const b2b = await gst.exportGstr1Section(client, auditor, ret.id, "b2b");
    assert(b2b.body.split("\n").length === 4 && b2b.body.includes(PUNE) && /offline-tool/.test(b2b.note), b2b.body);
    const b2cs = await gst.exportGstr1Section(client, auditor, ret.id, "b2cs");
    assert(b2cs.body.split("\n")[1].startsWith("OE,27,Intra-state,5,1000.00"), b2cs.body);
    const cdnr = await gst.exportGstr1Section(client, auditor, ret.id, "cdnr");
    assert(cdnr.body.split("\n")[1].includes(",C,27,1180.00,"), cdnr.body);
    const hsn = await gst.exportGstr1Section(client, auditor, ret.id, "hsn");
    assert(hsn.body.includes("B2B,84713010") && hsn.body.includes("B2C,0402"), hsn.body);
    await refused(() => gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" }), "GST_RETURN_LOCKED");
    await refused(() => gst.fileGstReturn(client, approver, ret.id, {}), "GST_REFERENCE_REQUIRED");
    ret = await gst.fileGstReturn(client, approver, ret.id, { reference: "AA2710260012345", filedOn: "2026-10-11" });
    await refused(() => gst.reopenGstReturn(client, approver, ret.id, { reason: "x" }), "GST_RETURN_STATE");
    assert(ret.status === "FILED" && ret.filingReference === "AA2710260012345", ret.status);
  });

  await check("G5. After filing, reversing a reported invoice is flagged on October's return as an amendment; October reports only October's documents", async () => {
    await accounting.reverseCustomerInvoice(client, owner, inv2, { reason: "Goods returned in full" });
    await post({ partyId: pune, date: "2026-10-03", gstinOf: PUNE, pos: "27", name: "Pune Traders", lines: [{ net: 3000, tax: 540, details: [g("cgst", 3000, 270, 9), g("sgst", 3000, 270, 9)] }] });
    const oct = await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-10" });
    const full = await gst.getGstReturn(client, preparer, oct.id);
    const amendment = full.exceptions.find((x) => x.code === "AMENDED_AFTER_FILING");
    assert(amendment && amendment.source_id === inv2 && /amendment/.test(amendment.message), JSON.stringify(full.exceptions.map((x) => x.code)));
    assert(oct.summary.sections.b2b.documents === 1, String(oct.summary.sections.b2b.documents));
  });

  await check("G6. The outward summary splits taxable from exempt by month; the inward summary keeps supplier GST awaiting confirmation apart from claimable credit", async () => {
    const out = await gst.outwardGstSummary(client, auditor, { registrationId: reg.id, from: "2026-09", to: "2026-09" });
    const exempt = out.rows.find((r) => r.classification === "exempt");
    assert(exempt && exempt.taxable === 5000 && out.rows.some((r) => r.classification === "taxable"), JSON.stringify(out.rows));
    const supplier = (await client.query(`INSERT INTO tenant.business_parties (organization_id, code, party_type, display_name, legal_name, currency_code, status) VALUES ($1, $2, 'supplier', 'Steel Supplier', 'Steel Supplier', 'INR', 'active') RETURNING id`,
      [organizationId, `S-STL-${tag.slice(0, 4)}`])).rows[0].id;
    const expense = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code LIKE '5%' AND NOT is_group ORDER BY code LIMIT 1", [organizationId])).rows[0].id;
    const created = await accounting.createVendorBill(client, owner, { partyId: supplier, billDate: "2026-09-10", dueDate: "2026-10-10", supplierInvoiceNumber: `SI-${tag.slice(0, 5)}`,
      lines: [{ description: "Steel", quantity: 1, unitPrice: "50000", taxAmount: "9000", taxDetails: [g("cgst", 50000, 4500, 9), g("sgst", 50000, 4500, 9)], accountId: expense, hsnSacCode: "7208" }] });
    const billId = created.id ?? created.bill?.id;
    await client.query("UPDATE tenant.accounting_vendor_bills SET status = 'approved' WHERE organization_id = $1 AND id = $2", [organizationId, billId]);
    await accounting.postVendorBill(client, owner, billId);
    const inward = await gst.inwardGstSummary(client, auditor, { registrationId: reg.id, from: "2026-09", to: "2026-09" });
    assert(inward.pending.cgst === 4500 && inward.pending.taxable === 50000 && inward.claimable.cgst === 0, JSON.stringify(inward));
  });
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
