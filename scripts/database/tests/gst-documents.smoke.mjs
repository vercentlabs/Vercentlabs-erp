// GST MVP 43 (e-invoice and e-way-bill readiness and portal references): a document's data is checked against what the IRP / e-way-bill
// system needs ("ready" is not "generated"); the obligations list shows invoices of GSTINs under the mandate without an IRN; an IRN or
// e-way bill generated on the government portal is recorded against the document (validated, once), clearing the obligation; a portal
// cancellation is recorded within 24 hours only.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:gst-documents     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the GST documents suite on the live database. Set SMOKE_DATABASE to a scratch database.");
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
    fullName: "Smoke Owner", email: `gstdoc-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `GST docs ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
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

  await client.query(`UPDATE tenant.tax_registrations SET einvoice_applicable = true, einvoice_applicable_from = '2026-04-01' WHERE id = $1`, [reg.id]);
  const address = { line1: "12 MG Road", city: "Pune", postalCode: "411001", stateCode: "27" };
  const b2b = async (date = "2026-09-05") => {
    const created = await accounting.createCustomerInvoice(client, owner, { partyId: pune, invoiceDate: date, dueDate: date, placeOfSupply: "27", billingAddressSnapshot: address,
      customerSnapshot: { id: pune, displayName: "Pune Traders", legalName: "Pune Traders", gstin: PUNE },
      lines: [{ description: "Laptop", quantity: 1, unitPrice: "10000", taxAmount: "1800", taxDetails: [g("cgst", 10000, 900, 9), g("sgst", 10000, 900, 9)], hsnSacCode: "84713010", accountId: revenue }] });
    const id = created.id ?? created.invoice?.id;
    await client.query("UPDATE tenant.accounting_customer_invoices SET status = 'approved' WHERE organization_id = $1 AND id = $2", [organizationId, id]);
    await accounting.postCustomerInvoice(client, owner, id);
    return id;
  };
  const IRN = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
  let inv;
  let b2c;

  await check("D1. Readiness: a B2B invoice of a GSTIN under the mandate is checked against what the IRP needs — the seller's missing address blocks it, fixed it is ready; a B2C invoice needs no IRN; ready is not generated; seen by GST users and whoever can see the invoice", async () => {
    inv = await b2b();
    b2c = await post({ partyId: walkin, date: "2026-09-06", pos: "27", lines: [{ net: 500, tax: 90, details: [g("cgst", 500, 45, 9), g("sgst", 500, 45, 9)] }] });
    const before = await gst.getEInvoiceReadiness(client, auditor, inv);
    assert(before.applicable && !before.ready && before.problems.some((p) => /no address/.test(p.message)) && before.problems.some((p) => /PIN/.test(p.message)), JSON.stringify(before.problems));
    await client.query(`UPDATE tenant.tax_registrations SET address_line1 = 'Plot 4, MIDC', city = 'Pune', postal_code = '411019' WHERE id = $1`, [reg.id]);
    const after = await gst.getEInvoiceReadiness(client, auditor, inv);
    assert(after.ready && after.live === null && /not an e-invoice/.test(after.meaning), JSON.stringify(after.problems));
    const consumer = await gst.getEInvoiceReadiness(client, auditor, b2c);
    assert(!consumer.applicable && /B2C/.test(consumer.why), consumer.why);
    assert((await gst.getEInvoiceReadiness(client, seller, inv)).ready, "whoever can see the invoice sees its readiness");
    const staff = await addMember("employee", "Esha Employee");
    await refused(() => gst.getEInvoiceReadiness(client, staff, inv), "GST_FORBIDDEN");
  });

  await check("D2. The obligations list shows the B2B invoice as needing an IRN (not the B2C one)", async () => {
    const due = await gst.listGstDocumentObligations(client, auditor, { from: "2026-09-01", to: "2026-09-30" });
    assert(due.einvoiceDue.length === 1 && due.einvoiceDue[0].invoiceId === inv && due.ewayDue.length === 0, JSON.stringify(due.einvoiceDue));
  });

  await check("D3. An IRN generated on the portal is recorded (64-character IRN, acknowledgement) once; the obligation clears, and GSTR-1 no longer warns about it", async () => {
    await refused(() => gst.recordPortalEInvoice(client, owner, inv, { irn: "123", ackNumber: "112610012345678", ackDate: new Date().toISOString() }), "EINVOICE_INVALID");
    await refused(() => gst.recordPortalEInvoice(client, owner, inv, { irn: IRN, ackNumber: "ACK", ackDate: new Date().toISOString() }), "EINVOICE_INVALID");
    await refused(() => gst.recordPortalEInvoice(client, auditor, inv, { irn: IRN, ackNumber: "112610012345678", ackDate: new Date().toISOString() }), "GST_FORBIDDEN");
    const rec = await gst.recordPortalEInvoice(client, owner, inv, { irn: IRN.toUpperCase(), ackNumber: "112610012345678", ackDate: new Date(Date.now() - 3600_000).toISOString() });
    assert(rec.origin === "external" && rec.irn === IRN, JSON.stringify(rec));
    await refused(() => gst.recordPortalEInvoice(client, owner, inv, { irn: IRN, ackNumber: "112610012345678", ackDate: new Date().toISOString() }), "EINVOICE_EXISTS");
    const due = await gst.listGstDocumentObligations(client, auditor, { from: "2026-09-01", to: "2026-09-30" });
    assert(due.einvoiceDue.length === 0, "cleared");
    const r = await gst.prepareGstr1(client, preparer, { registrationId: reg.id, period: "2026-09" });
    const warnings = (await gst.getGstReturn(client, preparer, r.id)).exceptions.filter((x) => x.code === "EINVOICE_MISSING");
    assert(warnings.length === 0, JSON.stringify(warnings));
    assert((await gst.getEInvoiceReadiness(client, auditor, inv)).live?.origin === "external", "the live IRN shows");
  });

  await check("D4. A portal cancellation within 24 hours is recorded and the invoice is due again; an IRN older than 24 hours can't be cancelled (a credit note corrects it)", async () => {
    await refused(() => gst.recordPortalEInvoiceCancellation(client, owner, inv, {}), "GST_REASON_REQUIRED");
    await gst.recordPortalEInvoiceCancellation(client, owner, inv, { reason: "Wrong quantity" });
    assert((await gst.listGstDocumentObligations(client, auditor, { from: "2026-09-01", to: "2026-09-30" })).einvoiceDue.length === 1, "due again");
    await gst.recordPortalEInvoice(client, owner, inv, { irn: "b".repeat(64), ackNumber: "112610012345679", ackDate: new Date(Date.now() - 2 * 864e5).toISOString() });
    await refused(() => gst.recordPortalEInvoiceCancellation(client, owner, inv, { reason: "late" }), "EINVOICE_CANCEL_WINDOW_PASSED");
  });

  await check("D5. E-way bill references are checked (12-digit number, validity after generation, a real movement) before they are recorded", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    await refused(() => gst.recordPortalEwayBill(client, owner, "pos_sale", id, {}), "EWAY_SOURCE_INVALID");
    await refused(() => gst.recordPortalEwayBill(client, owner, "sales_delivery", id, { ewbNumber: "12345", ewbDate: new Date().toISOString(), validUntil: new Date(Date.now() + 864e5).toISOString() }), "EWAY_INVALID");
    await refused(() => gst.recordPortalEwayBill(client, owner, "sales_delivery", id, { ewbNumber: "123456789012", ewbDate: new Date().toISOString(), validUntil: new Date(Date.now() - 864e5).toISOString() }), "EWAY_INVALID");
    await refused(() => gst.recordPortalEwayBill(client, owner, "sales_delivery", id, { ewbNumber: "123456789012", ewbDate: new Date().toISOString(), validUntil: new Date(Date.now() + 864e5).toISOString() }), "EWAY_SOURCE_NOT_FOUND");
  });
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
