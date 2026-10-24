// The customer portal (Sales report Phase 3). A company switches it on in Sales settings and gets one portal address. A customer opens
// it, types their email — the customer's own or one of its contacts' — and gets a 6-digit code by email; the code signs them in for 7
// days. They see their quotations, orders and final invoices, what they owe, and open each quotation or invoice on its shared link
// (accept, pay now). Nothing else of the company is reachable: every read is limited to the customers that email belongs to.
// The answer to "send me a code" is the same whether or not the email is known, so the portal does not reveal who is a customer.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { setTenantContext } from "@vercentlabs/database";

import { escapeHtml } from "../../core/platform/mail/index.js";
import { sendMail } from "../../core/platform/mail/transport.js";
import { decryptSecret, encryptSecret } from "../../core/platform/secrets/index.js";
import { linkUrlFor } from "./portal.js";
import { SalesError } from "./index.js";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const KEY = /^[A-Za-z0-9_-]{20,60}$/;
const CODE_MINUTES = 10;
const SESSION_DAYS = 7;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const day = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : null);
const portalUrl = (key, env) => `${String(env.APP_URL ?? "").replace(/\/+$/, "")}/p/${key}`;

// ------------------------------------------------------------------ setup (Sales settings)
export async function getCustomerPortal(client, context, env = process.env) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up the customer portal.", "PERMISSION_DENIED");
  const row = (await client.query("SELECT * FROM tenant.sales_customer_portals WHERE organization_id = $1", [context.organizationId])).rows[0];
  if (!row) return { portal: { on: false, url: null } };
  const key = (await decryptSecret(row.key_encrypted, env))?.key;
  return { portal: { on: row.status === "active", url: key ? portalUrl(key, env) : null } };
}

// input: { on, newAddress? } — newAddress makes a new portal address (the old one stops working, and everyone is signed out).
export async function setCustomerPortal(client, context, input = {}, env = process.env) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up the customer portal.", "PERMISSION_DENIED");
  const existing = (await client.query("SELECT * FROM tenant.sales_customer_portals WHERE organization_id = $1 FOR UPDATE", [context.organizationId])).rows[0];
  if (!existing || input.newAddress === true) {
    const key = randomBytes(24).toString("base64url");
    await client.query(
      `INSERT INTO tenant.sales_customer_portals (organization_id, key_hash, key_encrypted, status, updated_by) VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (organization_id) DO UPDATE SET key_hash = EXCLUDED.key_hash, key_encrypted = EXCLUDED.key_encrypted, status = EXCLUDED.status, updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [context.organizationId, hash(key), JSON.stringify(await encryptSecret({ key }, env)), input.on === false ? "inactive" : "active", context.userId ?? null]);
    if (existing) await client.query("DELETE FROM tenant.sales_portal_sessions WHERE organization_id = $1", [context.organizationId]);
  } else {
    await client.query("UPDATE tenant.sales_customer_portals SET status = $2, updated_by = $3, updated_at = now() WHERE organization_id = $1",
      [context.organizationId, input.on === false ? "inactive" : "active", context.userId ?? null]);
  }
  return getCustomerPortal(client, context, env);
}

// ------------------------------------------------------------------ the portal (no staff sign-in)
// The company behind a portal address, with the tenant set; null for an unknown or switched-off address.
async function resolvePortal(client, key) {
  if (!KEY.test(String(key ?? ""))) return null;
  const found = (await client.query("SELECT * FROM tenant.sales_resolve_customer_portal($1)", [hash(key)])).rows[0];
  if (!found) return null;
  await setTenantContext(client, found.organization_id);
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1", [found.organization_id])).rows[0];
  return { organizationId: found.organization_id, company: company?.name ?? "" };
}

// The active customers an email belongs to: the customer's own email, or an active contact's.
async function customersOf(client, organizationId, email) {
  return (await client.query(
    `SELECT DISTINCT party.id FROM tenant.business_parties party
      WHERE party.organization_id = $1 AND party.status = 'active' AND (party.customer_number IS NOT NULL OR party.party_type IN ('customer', 'both'))
        AND (lower(party.email) = $2 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships link JOIN tenant.contacts contact ON contact.id = link.contact_id
              WHERE link.organization_id = party.organization_id AND link.party_id = party.id AND link.status = 'active' AND contact.status = 'active' AND lower(contact.email) = $2))
      LIMIT 20`, [organizationId, email])).rows.map((row) => row.id);
}

// "Send me a code". Always { sent: true } for a valid portal, known email or not. options.deliver(email, code) replaces the email (tests).
export async function requestPortalCode(client, key, input = {}, { env = process.env, deliver } = {}) {
  const portal = await resolvePortal(client, key);
  if (!portal) return null;
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) throw new SalesError(400, "Enter your email address.", "SALES_PORTAL_INVALID", { field: "email" });
  const parties = await customersOf(client, portal.organizationId, email);
  if (!parties.length) return { sent: true };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await client.query("UPDATE tenant.sales_portal_codes SET used_at = now() WHERE organization_id = $1 AND email = $2 AND used_at IS NULL", [portal.organizationId, email]);
  await client.query(
    `INSERT INTO tenant.sales_portal_codes (organization_id, email, party_ids, code_hash, expires_at) VALUES ($1, $2, $3::uuid[], $4, now() + make_interval(mins => $5))`,
    [portal.organizationId, email, parties, hash(`${email}:${code}`), CODE_MINUTES]);
  if (deliver) await deliver(email, code);
  else {
    const text = `Your code to sign in to ${portal.company}'s customer portal is ${code}. It works for ${CODE_MINUTES} minutes. If you did not ask for it, ignore this email.`;
    await sendMail({ meter: { client, organizationId: portal.organizationId }, to: email, subject: `${code} is your ${portal.company} portal code`, text,
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(text)}</body></html>` }, env);
  }
  return { sent: true };
}

// The code typed: a session token (7 days) for the cookie, or a refusal. Five wrong tries spend the code.
export async function verifyPortalCode(client, key, input = {}) {
  const portal = await resolvePortal(client, key);
  if (!portal) return null;
  const email = String(input.email ?? "").trim().toLowerCase();
  const code = String(input.code ?? "").replace(/\s+/g, "");
  const row = (await client.query(
    `SELECT * FROM tenant.sales_portal_codes WHERE organization_id = $1 AND email = $2 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [portal.organizationId, email])).rows[0];
  const wrong = new SalesError(400, "That code is not right, or it has expired. Ask for a new one.", "SALES_PORTAL_CODE");
  if (!row || !/^\d{6}$/.test(code)) throw wrong;
  const expected = Buffer.from(row.code_hash);
  const given = Buffer.from(hash(`${email}:${code}`));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await client.query("UPDATE tenant.sales_portal_codes SET attempts = attempts + 1, used_at = CASE WHEN attempts + 1 >= 5 THEN now() END WHERE id = $1", [row.id]);
    throw wrong;
  }
  await client.query("UPDATE tenant.sales_portal_codes SET used_at = now() WHERE id = $1", [row.id]);
  const token = randomBytes(32).toString("base64url");
  await client.query(
    `INSERT INTO tenant.sales_portal_sessions (organization_id, email, party_ids, token_hash, expires_at) VALUES ($1, $2, $3::uuid[], $4, now() + make_interval(days => $5))`,
    [portal.organizationId, email, row.party_ids, hash(token), SESSION_DAYS]);
  return { token, maxAgeSeconds: SESSION_DAYS * 86_400 };
}

async function sessionOf(client, portal, token) {
  if (!token || String(token).length > 100) return null;
  const row = (await client.query("SELECT * FROM tenant.sales_portal_sessions WHERE organization_id = $1 AND token_hash = $2 AND expires_at > now()",
    [portal.organizationId, hash(token)])).rows[0];
  if (!row) return null;
  await client.query("UPDATE tenant.sales_portal_sessions SET last_seen_at = now() WHERE id = $1", [row.id]);
  // A customer switched off since signing in is no longer shown.
  const parties = (await client.query("SELECT id, display_name FROM tenant.business_parties WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'",
    [portal.organizationId, row.party_ids])).rows;
  return parties.length ? { email: row.email, parties } : null;
}

export async function signOutOfPortal(client, key, token) {
  const portal = await resolvePortal(client, key);
  if (!portal || !token) return { signedOut: true };
  await client.query("DELETE FROM tenant.sales_portal_sessions WHERE organization_id = $1 AND token_hash = $2", [portal.organizationId, hash(token)]);
  return { signedOut: true };
}

// What a signed-in customer sees. Returns { signedIn: false, company } without a valid session; null for an unknown portal.
export async function loadCustomerPortal(client, key, token, env = process.env) {
  const portal = await resolvePortal(client, key);
  if (!portal) return null;
  const session = await sessionOf(client, portal, token);
  if (!session) return { signedIn: false, company: portal.company };
  const ids = session.parties.map((party) => party.id);
  const org = portal.organizationId;
  const quotations = (await client.query(
    `SELECT quote.id, quote.quotation_number, quote.quotation_date, quote.valid_until, quote.lifecycle_status, version.currency_code, version.grand_total
       FROM tenant.sales_quotations quote JOIN tenant.sales_quotation_versions version ON version.id = quote.current_version_id
      WHERE quote.organization_id = $1 AND quote.party_id = ANY($2::uuid[]) AND quote.lifecycle_status IN ('sent', 'accepted', 'rejected', 'expired')
      ORDER BY quote.quotation_date DESC, quote.created_at DESC LIMIT 50`, [org, ids])).rows;
  const orders = (await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number, sales_order.order_date, sales_order.lifecycle_status, sales_order.fulfillment_status, version.currency_code,
            version.grand_total, version.customer_po_number
       FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
      WHERE sales_order.organization_id = $1 AND sales_order.party_id = ANY($2::uuid[]) AND sales_order.lifecycle_status IN ('confirmed', 'closed')
      ORDER BY sales_order.order_date DESC, sales_order.created_at DESC LIMIT 50`, [org, ids])).rows;
  const invoices = (await client.query(
    `SELECT id, invoice_number, invoice_date, due_date, currency_code, grand_total, outstanding_amount, status FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND party_id = ANY($2::uuid[]) AND invoice_type = 'invoice' AND status NOT IN ('draft', 'cancelled', 'reversed')
      ORDER BY invoice_date DESC, created_at DESC LIMIT 100`, [org, ids])).rows;
  const today = (await client.query("SELECT tenant.company_today()::text AS today")).rows[0].today;
  const link = (kind, id) => linkUrlFor(client, org, kind, id, env);
  const FULFILLMENT = { not_started: "Being prepared", partially_fulfilled: "Partly delivered", fulfilled: "Delivered" };
  return {
    signedIn: true, company: portal.company, email: session.email, customers: session.parties.map((party) => party.display_name),
    owed: {
      due: invoices.reduce((total, row) => total + Number(row.outstanding_amount), 0),
      overdue: invoices.filter((row) => Number(row.outstanding_amount) > 0.005 && row.due_date && day(row.due_date) < today).reduce((total, row) => total + Number(row.outstanding_amount), 0),
    },
    quotations: await Promise.all(quotations.map(async (row) => ({ number: row.quotation_number, date: day(row.quotation_date), validUntil: day(row.valid_until),
      status: row.lifecycle_status === "sent" ? "Awaiting your answer" : row.lifecycle_status === "accepted" ? "Accepted" : row.lifecycle_status === "rejected" ? "Declined" : "Expired",
      currencyCode: String(row.currency_code).trim(), total: Number(row.grand_total), url: await link("quotation", row.id) }))),
    orders: orders.map((row) => ({ number: row.sales_order_number, date: day(row.order_date), yourPo: row.customer_po_number,
      status: row.lifecycle_status === "closed" ? "Completed" : FULFILLMENT[row.fulfillment_status] ?? "Confirmed", currencyCode: String(row.currency_code).trim(), total: Number(row.grand_total) })),
    invoices: await Promise.all(invoices.map(async (row) => ({ number: row.invoice_number, date: day(row.invoice_date), dueDate: day(row.due_date), currencyCode: String(row.currency_code).trim(),
      total: Number(row.grand_total), due: Number(row.outstanding_amount), overdue: Number(row.outstanding_amount) > 0.005 && Boolean(row.due_date) && day(row.due_date) < today,
      url: await link("invoice", row.id) }))),
  };
}
