// GST MVP 42 (GSTR-3B, GSTR-2B and input tax credit): outward liability (3.1, 3.2) from the documents issued; supplier GST counts as credit
// (4A) only once confirmed — matched GSTR-2B lines confirm it, mismatches and invoices missing from 2B are flagged; reversals (reclaimable
// or not) and reclaims post once and land in 4B / 4D; the summary stays "Draft — Reconciliation Required" (and can't be approved) until
// GSTR-1, GSTR-2B and the GL agree or each gap is accepted with a reason, and goes stale when its inputs change.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:gst-3b     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the GST 3B suite on the live database. Set SMOKE_DATABASE to a scratch database.");
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
    fullName: "Smoke Owner", email: `gst3b-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `GST 3B ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
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

  const supplierParty = async (name, code) => (await client.query(`INSERT INTO tenant.business_parties (organization_id, code, party_type, display_name, legal_name, currency_code, status)
    VALUES ($1, $2, 'supplier', $3, $3, 'INR', 'active') RETURNING id`, [organizationId, `${code}-${tag.slice(0, 4)}`, name])).rows[0].id;
  const steel = await supplierParty("Steel Mills", "S-STL");
  const chem = await supplierParty("Chem Corp", "S-CHM");
  const STEEL = gstin("27", "AACCS1111A");
  const CHEM = gstin("29", "AACCC2222B");
  const expense = (await client.query("SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND code LIKE '5%' AND NOT is_group ORDER BY code LIMIT 1", [organizationId])).rows[0].id;
  const bill = async ({ partyId, gst: supplierGstin, number, date = "2026-09-12", net, details }) => {
    const total = details.reduce((t, d) => t + Number(d.taxAmount), 0);
    const created = await accounting.createVendorBill(client, owner, { partyId, billDate: date, dueDate: "2026-10-31", supplierInvoiceNumber: number,
      lines: [{ description: "Material", quantity: 1, unitPrice: String(net), taxAmount: String(total), taxDetails: details, accountId: expense, hsnSacCode: "7208" }] });
    const id = created.id ?? created.bill?.id;
    await client.query(`UPDATE tenant.accounting_vendor_bills SET status = 'approved', supplier_snapshot = COALESCE(supplier_snapshot, '{}'::jsonb) || jsonb_build_object('gstin', $3::text) WHERE organization_id = $1 AND id = $2`,
      [organizationId, id, supplierGstin]);
    await accounting.postVendorBill(client, owner, id);
    return id;
  };
  const ex = async (id) => (await gst.getGstReturn(client, preparer, id)).exceptions;

  let billA;
  let billB;
  let billC;
  let r3b;
  await check("T1. September: outward taxable ₹30,000 (3.1a) with ₹20,000 inter-state to an unregistered buyer (3.2), ₹5,000 exempt (3.1c); supplier GST waiting for confirmation is not credit; without GSTR-1 and GSTR-2B it is a draft that can't be approved", async () => {
    await post({ partyId: pune, date: "2026-09-05", gstinOf: PUNE, pos: "27", name: "Pune Traders", lines: [{ net: 10000, tax: 1800, details: [g("cgst", 10000, 900, 9), g("sgst", 10000, 900, 9)] }] });
    await post({ partyId: walkin, date: "2026-09-06", pos: "07", lines: [{ net: 20000, tax: 3600, details: [g("igst", 20000, 3600, 18)] }] });
    await post({ partyId: pune, date: "2026-09-07", gstinOf: PUNE, pos: "27", supplyType: "exempt", lines: [{ net: 5000, hsn: "0701" }] });
    billA = await bill({ partyId: steel, gst: STEEL, number: "SA/001", net: 50000, details: [g("cgst", 50000, 4500, 9), g("sgst", 50000, 4500, 9)] });
    billB = await bill({ partyId: chem, gst: CHEM, number: "CC-77", net: 20000, details: [g("igst", 20000, 3600, 18)] });
    billC = await bill({ partyId: steel, gst: STEEL, number: "SA/002", net: 10000, details: [g("cgst", 10000, 900, 9), g("sgst", 10000, 900, 9)] });
    await refused(() => gst.prepareGstr3b(client, seller, { registrationId: reg.id, period: "2026-09" }), "GST_FORBIDDEN");
    r3b = await gst.prepareGstr3b(client, preparer, { registrationId: reg.id, period: "2026-09" });
    const s = r3b.summary;
    assert(s.table31.a.taxable === 30000 && s.table31.a.igst === 3600 && s.table31.a.cgst === 900 && s.table31.c.taxable === 5000, JSON.stringify(s.table31));
    assert(s.table32.length === 1 && s.table32[0].pos === "07" && s.table32[0].igst === 3600, JSON.stringify(s.table32));
    assert(s.table4.a5.cgst === 0 && s.pending.cgst === 5400 && s.pending.igst === 3600, JSON.stringify([s.table4.a5, s.pending]));
    assert(r3b.label === "Draft GSTR-3B Summary — Reconciliation Required", r3b.label);
    const codes = (await ex(r3b.id)).map((x) => x.code).sort().join();
    assert(codes.includes("GSTR1_NOT_PREPARED") && codes.includes("TWO_B_NOT_IMPORTED") && codes.includes("ITC_PENDING"), codes);
    await refused(() => gst.approveGstReturn(client, approver, r3b.id), "GST_RETURN_NOT_RECONCILED");
  });

  await check("T2. GSTR-2B import: Steel's SA-001 matches SA/001, Chem's CC-77 differs by ₹100 IGST, an invoice not in the books, a bad GSTIN skipped; SA/002 is in the books but not in 2B", async () => {
    const csv = ["GSTIN of supplier,Trade/Legal name,Invoice number,Invoice type,Invoice Date,Place of supply,Supply Attract Reverse Charge,Taxable Value,Integrated Tax,Central Tax,State/UT Tax,Cess,ITC Availability",
      `${STEEL},Steel Mills,SA-001,Regular,12-09-2026,27-Maharashtra,N,"50,000.00",0,4500,4500,0,Yes`,
      `${CHEM},Chem Corp,CC-77,Regular,12-09-2026,27-Maharashtra,N,20000,3500,0,0,0,Yes`,
      `${STEEL},Steel Mills,SA-099,Regular,14-09-2026,27-Maharashtra,N,1000,0,90,90,0,Yes`,
      "27BADGSTIN0000,Nobody,X-1,Regular,01-09-2026,27,N,10,0,1,1,0,Yes"].join("\n");
    await refused(() => gst.importGstr2b(client, auditor, { registrationId: reg.id, period: "2026-09", csv }), "GST_FORBIDDEN");
    const rec = await gst.importGstr2b(client, preparer, { registrationId: reg.id, period: "2026-09", fileName: "2B-092026.csv", csv });
    assert(rec.counts.matched === 1 && rec.counts.mismatch === 1 && rec.counts.notInBooks === 1 && rec.imported.skipped.length === 1, JSON.stringify(rec.counts));
    assert(rec.notIn2b.length === 1 && rec.notIn2b[0].sourceId === billC, JSON.stringify(rec.notIn2b));
    const diff = rec.lines.find((l) => l.match_status === "mismatch");
    assert(diff.matched_source_id === billB && Number(diff.difference.igst) === -100, JSON.stringify(diff.difference));
  });

  await check("T3. Confirming matched credit moves Steel's ₹9,000 to claimable (4A5) in September; the mismatch and the invoice missing from 2B stay flagged", async () => {
    const done = await gst.confirmGstr2bMatchedCredit(client, preparer, { registrationId: reg.id, period: "2026-09" });
    assert(done.confirmed === 1, JSON.stringify(done));
    r3b = await gst.prepareGstr3b(client, preparer, { registrationId: reg.id, period: "2026-09" });
    assert(r3b.summary.table4.a5.cgst === 4500 && r3b.summary.table4.a5.sgst === 4500 && r3b.summary.pending.cgst === 900, JSON.stringify(r3b.summary.table4.a5));
    const codes = (await ex(r3b.id)).filter((x) => x.status === "open").map((x) => x.code);
    assert(codes.includes("TWO_B_MISMATCH") && !codes.includes("TWO_B_NOT_IMPORTED") && !codes.includes("ITC_NOT_IN_2B"), codes.join());
  });

  let reversal;
  await check("T4. Steel unpaid after 180 days: ₹2,000 of its credit reversed (reclaimable, 4B2) — never more than was claimed — and reclaimed once in October (4D1); the GL agrees", async () => {
    await refused(() => gst.reverseInputTaxCredit(client, preparer, { registrationId: reg.id, period: "2026-09", reasonCode: "rule_37_non_payment", sourceType: "vendor_bill", sourceId: billA, cgst: 5000, note: "x" }), "GST_ITC_EXCEEDS_CLAIMED");
    await refused(() => gst.reverseInputTaxCredit(client, preparer, { registrationId: reg.id, period: "2026-09", reasonCode: "rule_37_non_payment", cgst: 1000 }), "GST_REASON_REQUIRED");
    reversal = await gst.reverseInputTaxCredit(client, preparer, { registrationId: reg.id, period: "2026-09", reasonCode: "rule_37_non_payment", sourceType: "vendor_bill", sourceId: billA,
      cgst: 1000, sgst: 1000, note: "SA/001 unpaid beyond 180 days", idempotencyKey: `rev-${tag}` });
    const again = await gst.reverseInputTaxCredit(client, preparer, { registrationId: reg.id, period: "2026-09", reasonCode: "rule_37_non_payment", sourceType: "vendor_bill", sourceId: billA,
      cgst: 1000, sgst: 1000, note: "SA/001 unpaid beyond 180 days", idempotencyKey: `rev-${tag}` });
    assert(reversal.reclaimable && again.replayed && again.id === reversal.id, "posted once");
    r3b = await gst.prepareGstr3b(client, preparer, { registrationId: reg.id, period: "2026-09" });
    const t4 = r3b.summary.table4;
    assert(t4.b2.cgst === 1000 && t4.net.cgst === 3500 && t4.net.sgst === 3500, JSON.stringify(t4));
    assert(r3b.summary.gl && r3b.summary.gl.cgst === 3500 && !(await ex(r3b.id)).some((x) => x.code === "GL_ITC_MISMATCH" && x.status === "open"), JSON.stringify(r3b.summary.gl));
    const back = await gst.reclaimInputTaxCredit(client, preparer, reversal.id, { period: "2026-10", note: "Paid on 15 Oct" });
    await refused(() => gst.reclaimInputTaxCredit(client, preparer, reversal.id, { period: "2026-10", note: "again" }), "GST_ITC_ALREADY_RECLAIMED");
    const oct = await gst.prepareGstr3b(client, preparer, { registrationId: reg.id, period: "2026-10" });
    assert(back.kind === "reclaim" && oct.summary.table4.d1.cgst === 1000 && oct.summary.table4.net.cgst === 1000, JSON.stringify(oct.summary.table4));
  });

  await check("T5. With GSTR-1 prepared and the 2B mismatch accepted with a reason, the summary is reconciled and approved by someone else; a later supplier invoice makes it stale; the CSV working paper carries its label", async () => {
    await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" });
    r3b = await gst.prepareGstr3b(client, preparer, { registrationId: reg.id, period: "2026-09" });
    for (const x of (await ex(r3b.id)).filter((e) => e.status === "open" && e.severity === "warning")) await gst.waiveGstException(client, preparer, x.id, { note: `Reviewed: ${x.code}` });
    const now = await gst.getGstReturn(client, preparer, r3b.id);
    assert(now.label === "Reconciled working paper — not filed", now.label);
    await refused(() => gst.approveGstReturn(client, preparer, r3b.id), "GST_FORBIDDEN");
    await bill({ partyId: chem, gst: CHEM, number: "CC-78", net: 1000, details: [g("igst", 1000, 180, 18)] });
    await refused(() => gst.approveGstReturn(client, approver, r3b.id), "GST_RETURN_STALE");
    r3b = await gst.prepareGstr3b(client, preparer, { registrationId: reg.id, period: "2026-09" });
    for (const x of (await ex(r3b.id)).filter((e) => e.status === "open" && e.severity === "warning")) await gst.waiveGstException(client, preparer, x.id, { note: `Reviewed: ${x.code}` });
    const ok = await gst.approveGstReturn(client, approver, r3b.id);
    assert(ok.status === "APPROVED" && /not filed/.test(ok.label), ok.label);
    const csv = await gst.exportGstr3b(client, auditor, r3b.id);
    assert(csv.body.startsWith("Approved working paper") && csv.body.includes("3.1(a)") && csv.body.includes("4(B)(2)"), csv.body.split("\n").slice(0, 3).join(" | "));
  });
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
