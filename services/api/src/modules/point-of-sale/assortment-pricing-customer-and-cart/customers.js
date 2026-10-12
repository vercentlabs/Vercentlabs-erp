// Named Customer (migration 0088): POS's window onto the shared Customer Master (tenant.business_parties) — search, a short preview, the
// customer's billing addresses, a quick-create that goes through the Customer Master's own create (its validation, numbering and duplicate
// check) and a customer's POS purchase history. POS keeps no customer list of its own.
//
// What a cashier sees is limited: a name, the customer number, individual or business, whether they are GST-registered, the city, and a
// phone ending — full contacts only for those who may read the Customer Master. Never balances, credit limits or payment details.
import { accessiblePosStoreIds, assertPosStoreAccess, requirePermission } from "../shared/access-control.js";
import { posError } from "../shared/errors.js";
import { assertPosAction } from "../permissions/index.js";
import { createCustomer } from "../../sales/customers/records.js";
import { findDuplicateCustomers } from "../../sales/customers/duplicates.js";
import { gstStateName } from "../../sales/customers/constants.js";
import { POS_CUSTOMER_MESSAGES } from "./cart.js";

const MAX_LIMIT = 25;
const MAX_TERM_LENGTH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GST_REGISTERED = ["registered_regular", "registered_composition", "sez"];

const customerError = (status, code, message = POS_CUSTOMER_MESSAGES[code] ?? code, details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};

// Full contacts for Customer Master readers and POS administrators; a phone ending and a masked email for everyone else.
const canSeeContacts = (context) => context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
  || ["sales.customers.view", "pos.settings.manage", "pos.reports.view"].some((key) => context.permissions?.includes(key));
const phoneEnding = (value) => { const digits = String(value ?? "").replace(/\D/g, ""); return digits.length >= 4 ? digits.slice(-4) : null; };
const maskEmail = (value) => (value ? String(value).replace(/^(.)[^@]*(@.*)$/, "$1•••$2") : null);
const maskGstin = (value) => (value ? `${String(value).slice(0, 2)}•••••••••${String(value).slice(-4)}` : null);
const statusOf = (row) => (row.status !== "active" ? "inactive" : row.sales_block && row.sales_block !== "none" ? "blocked" : "active");

// The outlet a counter request is for: the bill's, else the caller's open session's.
async function counterOutlet(client, context, cartId) {
  if (cartId) {
    if (!UUID.test(String(cartId))) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
    const cart = (await client.query(`SELECT store_id, terminal_id, currency_code FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId])).rows[0];
    if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
    await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
    return { outletId: cart.store_id, currencyCode: cart.currency_code };
  }
  const session = (await client.query(
    `SELECT shift.store_id, store.currency_code FROM tenant.pos_shifts shift JOIN tenant.pos_stores store ON store.organization_id = shift.organization_id AND store.id = shift.store_id
      WHERE shift.organization_id=$1 AND shift.cashier_user_id=$2 AND shift.status='open' LIMIT 1`, [context.organizationId, context.userId])).rows[0];
  if (!session) throw posError(409, "Open a POS session to continue.", "POS_SESSION_REQUIRED");
  await assertPosStoreAccess(client, context, session.store_id);
  return { outletId: session.store_id, currencyCode: session.currency_code };
}

async function requireAction(client, context, permission, outletId, deniedCode) {
  try { await assertPosAction(client, context, { permission, outletId }); }
  catch (error) { if (error.code === "POS_PERMISSION_DENIED") throw customerError(403, deniedCode); throw error; }
}

// The same text the Customer Master's search index covers (business_parties_account_search_idx), so a partial match uses it.
const SEARCH_TEXT = `lower(COALESCE(party.code, '') || ' ' || COALESCE(party.display_name, '') || ' ' || COALESCE(party.legal_name, '') || ' ' || COALESCE(party.email, '')
  || ' ' || COALESCE(party.phone, '') || ' ' || COALESCE(party.secondary_phone, '') || ' ' || COALESCE(party.website, '') || ' ' || COALESCE(party.customer_number, '')
  || ' ' || COALESCE(party.gstin, ''))`;
const CUSTOMER_SQL = `(party.customer_number IS NOT NULL OR party.party_type IN ('customer', 'both')) AND party.status IN ('active', 'inactive')`;

function toResult(row, context) {
  const full = canSeeContacts(context);
  const ending = phoneEnding(row.phone);
  return {
    id: row.id,
    code: row.customer_code,
    name: row.display_name,
    legalName: row.legal_name && row.legal_name !== row.display_name ? row.legal_name : null,
    type: row.customer_kind === "individual" ? "individual" : "business",
    status: statusOf(row),
    gstRegistered: Boolean(row.gstin) && GST_REGISTERED.includes(row.tax_treatment ?? ""),
    phone: full ? row.phone ?? null : null,
    phoneEnding: ending,
    email: full ? row.email ?? null : maskEmail(row.email),
    city: row.city ?? null,
    state: row.state ?? null,
  };
}

// Customer search for the counter (CUSTOMER_SELECT): name (any part), customer number or account code, phone (digits, any formatting),
// email and GSTIN, ranked — exact customer number, exact GSTIN, exact phone or email, exact name, a number or name that starts with the
// text, then any other match. Inactive and blocked customers are listed and labelled (they cannot be chosen). Paged; never the whole list.
// input: query, cartId, limit, offset. Returns { rows, total, limit, offset }.
export async function searchPointOfSaleCustomers(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const { outletId } = await counterOutlet(client, context, input.cartId ?? null);
  await requireAction(client, context, "CUSTOMER_SELECT", outletId, "POS_CUSTOMER_SELECTION_DENIED");
  const term = String(input.query ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_TERM_LENGTH);
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), MAX_LIMIT);
  const offset = Math.max(Number(input.offset) || 0, 0);
  if (!term) return { rows: [], total: 0, limit, offset };
  const lower = term.toLowerCase();
  // A phone is matched on its digits; a number typed with the country code (+91 98765 43210) matches on its last ten.
  const allDigits = term.replace(/\D/g, "");
  const digits = allDigits.length > 10 ? allDigits.slice(-10) : allDigits;
  // $1 company, $2 the text anywhere, $3 the digits of a phone (4 or more); the ranking adds $4 the text and $5 the text in capitals (a GSTIN).
  const values = [context.organizationId, `%${lower.replace(/[\\%_]/g, "\\$&")}%`, digits.length >= 4 ? digits : ""];
  const where = `party.organization_id = $1 AND ${CUSTOMER_SQL}
      AND (${SEARCH_TEXT} LIKE $2 OR ($3 <> '' AND tenant.crm_normalize_phone(party.phone) LIKE '%' || $3 || '%'))`;
  const rank = `CASE
      WHEN lower(party.customer_number) = $4 OR lower(party.code) = $4 THEN 0
      WHEN party.gstin = $5 THEN 1
      WHEN ($3 <> '' AND tenant.crm_normalize_phone(party.phone) = $3) OR lower(party.email) = $4 THEN 2
      WHEN lower(party.display_name) = $4 OR lower(party.legal_name) = $4 THEN 3
      WHEN lower(party.customer_number) LIKE $4 || '%' OR lower(party.display_name) LIKE $4 || '%' OR lower(party.legal_name) LIKE $4 || '%' THEN 4
      ELSE 5 END`;
  const total = (await client.query(`SELECT count(*)::int AS total FROM tenant.business_parties party WHERE ${where}`, values)).rows[0].total;
  const { rows } = await client.query(
    `SELECT party.id, COALESCE(party.customer_number, party.code) AS customer_code, party.display_name, party.legal_name, party.customer_kind, party.status, party.sales_block,
            party.gstin, party.tax_treatment, party.phone, party.email, address.city, address.state, ${rank} AS rank
       FROM tenant.business_parties party
       LEFT JOIN LATERAL (SELECT city, state FROM tenant.addresses WHERE organization_id = party.organization_id AND party_id = party.id AND address_type = 'billing' AND status = 'active'
                           ORDER BY is_default_billing DESC, is_primary DESC, created_at LIMIT 1) address ON true
      WHERE ${where}
      ORDER BY rank, (party.status = 'active' AND party.sales_block = 'none') DESC, lower(party.display_name), party.id
      LIMIT ${limit} OFFSET ${offset}`, [...values, lower, term.toUpperCase()]);
  return { rows: rows.map((row) => toResult(row, context)), total, limit, offset };
}

// The customer's active billing addresses, the default first — the ones a bill may be invoiced to.
export async function listPosCustomerBillingAddresses(client, context, customerId) {
  const { rows } = await client.query(
    `SELECT id, label, line1, line2, city, state, state_code, postal_code, gstin, is_default_billing FROM tenant.addresses
      WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active' ORDER BY is_default_billing DESC, is_primary DESC, created_at`,
    [context.organizationId, customerId]);
  return rows.map((row) => ({
    id: row.id, label: row.label ?? null, line1: row.line1, line2: row.line2 ?? null, city: row.city ?? null, state: row.state ?? null, stateCode: row.state_code ?? null,
    postalCode: row.postal_code ?? null, gstin: row.gstin ?? null, isDefault: Boolean(row.is_default_billing),
  }));
}

// What the cashier needs to confirm the right customer (CUSTOMER_SELECT): identity, type, GST registration, price list, billing addresses,
// a limited contact, whether they can be used for a sale now, and how many POS purchases they have made. input: cartId.
export async function getPosCustomerPreview(client, context, customerId, input = {}) {
  requirePermission(context, "pos.view");
  const { outletId } = await counterOutlet(client, context, input.cartId ?? null);
  await requireAction(client, context, "CUSTOMER_SELECT", outletId, "POS_CUSTOMER_SELECTION_DENIED");
  if (!UUID.test(String(customerId ?? ""))) throw customerError(404, "POS_CUSTOMER_NOT_FOUND");
  const row = (await client.query(
    `SELECT party.id, COALESCE(party.customer_number, party.code) AS customer_code, party.display_name, party.legal_name, party.customer_kind, party.status, party.sales_block,
            party.gstin, party.tax_treatment, party.phone, party.email, price_list.id AS price_list_id, price_list.name AS price_list_name,
            address.city, address.state
       FROM tenant.business_parties party
       LEFT JOIN tenant.price_lists price_list ON price_list.organization_id = party.organization_id AND price_list.id = party.default_price_list_id AND price_list.status = 'active'
       LEFT JOIN LATERAL (SELECT city, state FROM tenant.addresses WHERE organization_id = party.organization_id AND party_id = party.id AND address_type = 'billing' AND status = 'active'
                           ORDER BY is_default_billing DESC, is_primary DESC, created_at LIMIT 1) address ON true
      WHERE party.organization_id=$1 AND party.id=$2 AND ${CUSTOMER_SQL}`, [context.organizationId, customerId])).rows[0];
  if (!row) throw customerError(404, "POS_CUSTOMER_NOT_FOUND");
  const stores = await accessiblePosStoreIds(client, context);
  const purchases = (await client.query(
    `SELECT count(*)::int AS total, max(completed_at) AS last_at FROM tenant.pos_sales
      WHERE organization_id=$1 AND customer_id=$2 AND status IN ('completed', 'partially_returned', 'returned')${stores ? " AND store_id = ANY($3::uuid[])" : ""}`,
    stores ? [context.organizationId, customerId, stores] : [context.organizationId, customerId])).rows[0];
  const base = toResult(row, context);
  return {
    ...base,
    gstin: base.gstRegistered || row.gstin ? (canSeeContacts(context) ? row.gstin : maskGstin(row.gstin)) : null,
    priceList: row.price_list_id ? { id: row.price_list_id, name: row.price_list_name } : null,
    billingAddresses: await listPosCustomerBillingAddresses(client, context, customerId),
    eligible: base.status === "active",
    ineligibleReason: base.status === "inactive" ? POS_CUSTOMER_MESSAGES.POS_CUSTOMER_INACTIVE : base.status === "blocked" ? "This customer is blocked from new sales." : null,
    purchases: { total: purchases.total, lastAt: purchases.last_at },
  };
}

// A customer created at the counter (CUSTOMER_QUICK_CREATE plus the Customer Master's own create): an individual (a name; phone and email
// optional) or a business (a name; GSTIN, billing address with state, contact person optional). Similar customers already on file — the same
// phone, email, GSTIN or a like name — are returned for review first (POS_CUSTOMER_POSSIBLE_DUPLICATE); the cashier creates anyway only by
// confirming it is a different customer (confirmNotDuplicate), and a strong match (same GSTIN or legal name) still needs the Customer
// Master's override permission and a reason. Never merges or edits an existing customer. The same idempotencyKey always returns the same
// customer. input: kind ("individual" | "business"), name, legalName, phone, email, gstin, billingAddress { line1, line2, city, stateCode,
// postalCode }, contactPerson, notes, cartId, idempotencyKey, confirmNotDuplicate, duplicateReason.
// Returns { customer, created, warnings }.
export async function quickCreatePosCustomer(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const { outletId, currencyCode } = await counterOutlet(client, context, input.cartId ?? null);
  await requireAction(client, context, "CUSTOMER_QUICK_CREATE", outletId, "POS_CUSTOMER_CREATION_DENIED");
  const key = String(input.idempotencyKey ?? "").trim();
  if (key) {
    const earlier = (await client.query(`SELECT customer_id FROM tenant.pos_customer_quick_creates WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, key])).rows[0];
    if (earlier) return { customer: await quickResult(client, context, earlier.customer_id), created: false, warnings: [] };
  }

  const kind = input.kind === "business" || (!input.kind && input.gstin) ? "business" : "individual";
  const text = (value, max) => { const out = String(value ?? "").trim().replace(/\s+/g, " "); return out ? out.slice(0, max) : null; };
  const name = text(input.name, 200);
  const phone = text(input.phone, 30);
  const email = text(input.email, 200)?.toLowerCase() ?? null;
  const gstin = text(input.gstin, 15)?.toUpperCase() ?? null;
  const raw = input.billingAddress ?? {};
  const address = { line1: text(raw.line1, 200), line2: text(raw.line2, 200), city: text(raw.city, 100), stateCode: text(raw.stateCode, 2), postalCode: text(raw.postalCode, 10) };
  const issues = [];
  if (!name) issues.push({ field: "name", message: kind === "business" ? "Enter the business name." : "Enter the customer's name." });
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) issues.push({ field: "phone", message: "Enter a phone number with 7 to 15 digits." });
  else if (phone) { const digits = phone.replace(/\D/g, ""); if (digits.length < 7 || digits.length > 15) issues.push({ field: "phone", message: "Enter a phone number with 7 to 15 digits." }); }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) issues.push({ field: "email", message: "Enter a valid email address." });
  if (gstin && kind !== "business") issues.push({ field: "gstin", message: "A GSTIN belongs to a business customer." });
  if (gstin && !GSTIN.test(gstin)) throw customerError(400, "POS_CUSTOMER_GSTIN_INVALID", "Enter a valid 15-character GSTIN.", { issues: [{ field: "gstin", message: "Enter a valid 15-character GSTIN." }] });
  const anyAddress = Object.values(address).some(Boolean);
  // An address, once started, is complete: the street, city, state and PIN code the invoice prints.
  if (anyAddress && !address.line1) issues.push({ field: "billingAddress.line1", message: "Enter the address." });
  if (anyAddress && !address.city) issues.push({ field: "billingAddress.city", message: "Enter the city." });
  if (anyAddress && !/^\d{2}$/.test(address.stateCode ?? "")) issues.push({ field: "billingAddress.stateCode", message: "Choose the state." });
  if (anyAddress && !/^\d{6}$/.test(address.postalCode ?? "")) issues.push({ field: "billingAddress.postalCode", message: "Enter the 6-digit PIN code." });
  // A GST-registered business invoice needs the state its GSTIN is registered in.
  if (gstin && GSTIN.test(gstin) && address.stateCode && address.stateCode !== gstin.slice(0, 2))
    issues.push({ field: "billingAddress.stateCode", message: "The state does not match the GSTIN." });
  if (issues.length) throw customerError(400, "POS_CUSTOMER_DETAILS_INVALID", issues[0].message, { issues });

  // The Customer Master's create, with its own permission added for this counter action only (CUSTOMER_QUICK_CREATE was checked above).
  const masterContext = { ...context, permissions: [...new Set([...(context.permissions ?? []), "sales.customers.create", "sales.customers.view"])] };
  const probe = { displayName: name, legalName: kind === "business" ? text(input.legalName, 200) ?? name : null, phone, email, gstin, city: address.city };
  if (input.confirmNotDuplicate !== true) {
    const found = await findDuplicateCustomers(client, masterContext, probe, { limit: 5 });
    if (found.matches.length) throw customerError(409, "POS_CUSTOMER_POSSIBLE_DUPLICATE", "A customer with similar details already exists. Review before creating another.", {
      matches: found.matches.filter((match) => match.isCustomer).map((match) => ({
        id: match.id, code: match.customerNumber ?? match.accountNumber, name: match.name, city: match.city, status: match.status, strength: match.strength,
        reasons: match.reasons.map((reason) => reason.label),
      })).concat(found.matches.filter((match) => !match.isCustomer).map((match) => ({
        id: match.id, code: match.accountNumber, name: match.name, city: match.city, status: match.status, strength: match.strength,
        reasons: [...match.reasons.map((reason) => reason.label), "A CRM account, not yet a customer"], notCustomer: true,
      }))),
      canOverrideStrong: found.canOverride,
    });
  }
  let created;
  try {
    created = await createCustomer(client, masterContext, {
      displayName: name, legalName: probe.legalName, customerKind: kind, phone, email, gstin,
      gstRegistrationType: gstin ? "registered_regular" : kind === "business" ? "unregistered" : "consumer",
      countryCode: "IN", currencyCode: String(currencyCode ?? "INR").trim(), origin: "pos",
      billingAddress: address.line1 ? { ...address, state: gstStateName(address.stateCode) ?? address.stateCode, countryCode: "IN" } : undefined,
      // A contact person becomes a contact only with a way to reach them (the Customer Master's rule); otherwise the name is kept in the notes.
      primaryContact: kind === "business" && text(input.contactPerson, 120) && (phone || email) ? { firstName: text(input.contactPerson, 120), phone, email } : undefined,
      notes: [text(input.notes, 1000), kind === "business" && text(input.contactPerson, 120) && !(phone || email) ? `Contact person: ${text(input.contactPerson, 120)}` : null]
        .filter(Boolean).join("\n") || undefined,
      allowDuplicate: input.confirmNotDuplicate === true, duplicateReason: text(input.duplicateReason, 500) ?? "Confirmed at the POS counter as a different customer.",
    });
  } catch (error) {
    if (error.code === "SALES_CUSTOMER_DUPLICATE" || error.code === "SALES_CUSTOMER_DUPLICATE_REASON_REQUIRED")
      throw customerError(409, "POS_CUSTOMER_POSSIBLE_DUPLICATE", error.message, error.details);
    if (error.code === "SALES_CUSTOMER_DUPLICATE_OVERRIDE_FORBIDDEN")
      throw customerError(403, "POS_CUSTOMER_POSSIBLE_DUPLICATE", "A customer with the same GSTIN or legal name exists. Use that customer, or ask a manager.", error.details);
    if (error.code === "SALES_CUSTOMER_VALIDATION" || String(error.code).startsWith("SALES_CUSTOMER_GSTIN")) {
      const gstinIssue = error.details?.issues?.some((issue) => issue.field === "gstin") || String(error.code).startsWith("SALES_CUSTOMER_GSTIN");
      throw customerError(400, gstinIssue ? "POS_CUSTOMER_GSTIN_INVALID" : "POS_CUSTOMER_DETAILS_INVALID", error.message, error.details);
    }
    throw error;
  }
  if (key) {
    // Two requests with the same key at once: the second waits on the unique key and returns the first one's customer.
    const stored = (await client.query(
      `INSERT INTO tenant.pos_customer_quick_creates (organization_id, idempotency_key, customer_id, store_id, cart_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING customer_id`,
      [context.organizationId, key, created.id, outletId, input.cartId ?? null, context.userId])).rows[0];
    if (!stored) throw customerError(409, "POS_CUSTOMER_CONTEXT_CONFLICT", "This customer was already created by an earlier request. Search for them.");
  }
  const warnings = !phone && !email ? ["No phone or email was given: finding this customer on a later visit may be harder."] : [];
  return { customer: await quickResult(client, context, created.id), created: true, warnings };
}

async function quickResult(client, context, customerId) {
  const row = (await client.query(
    `SELECT party.id, COALESCE(party.customer_number, party.code) AS customer_code, party.display_name, party.legal_name, party.customer_kind, party.status, party.sales_block,
            party.gstin, party.tax_treatment, party.phone, party.email, address.city, address.state
       FROM tenant.business_parties party
       LEFT JOIN LATERAL (SELECT city, state FROM tenant.addresses WHERE organization_id = party.organization_id AND party_id = party.id AND address_type = 'billing' AND status = 'active'
                           ORDER BY is_default_billing DESC, created_at LIMIT 1) address ON true
      WHERE party.organization_id=$1 AND party.id=$2`, [context.organizationId, customerId])).rows[0];
  return toResult(row, context);
}

// A customer's POS purchases (CUSTOMER_SELECT and TRANSACTION_LOOKUP) at the outlets the caller may see, newest first, from finished sales
// only: receipt, date, outlet, total, how it was paid, sale status and what has been refunded. Read-only. input: cartId, limit, offset.
export async function getPosCustomerPurchaseHistory(client, context, customerId, input = {}) {
  requirePermission(context, "pos.view");
  const { outletId } = await counterOutlet(client, context, input.cartId ?? null);
  await requireAction(client, context, "CUSTOMER_SELECT", outletId, "POS_CUSTOMER_SELECTION_DENIED");
  await requireAction(client, context, "TRANSACTION_LOOKUP", outletId, "POS_CUSTOMER_SELECTION_DENIED");
  if (!UUID.test(String(customerId ?? ""))) throw customerError(404, "POS_CUSTOMER_NOT_FOUND");
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const values = [context.organizationId, customerId];
  let scope = "";
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); scope = ` AND sale.store_id = ANY($${values.length}::uuid[])`; }
  const where = `sale.organization_id = $1 AND sale.customer_id = $2 AND sale.status IN ('completed', 'partially_returned', 'returned')${scope}`;
  const total = (await client.query(`SELECT count(*)::int AS total FROM tenant.pos_sales sale WHERE ${where}`, values)).rows[0].total;
  const { rows } = await client.query(
    `SELECT sale.id, sale.receipt_number, sale.completed_at, sale.status, sale.currency_code, sale.grand_total::text AS grand_total, sale.paid_total::text AS paid_total,
            store.code AS store_code, store.name AS store_name,
            COALESCE((SELECT sum(ret.refund_total) FROM tenant.pos_returns ret WHERE ret.organization_id = sale.organization_id AND ret.sale_id = sale.id AND ret.status = 'completed'), 0)::text AS refunded,
            (SELECT string_agg(DISTINCT payment.payment_method, ',') FROM tenant.pos_payments payment
              WHERE payment.organization_id = sale.organization_id AND payment.sale_id = sale.id AND payment.status = 'captured') AS methods
       FROM tenant.pos_sales sale JOIN tenant.pos_stores store ON store.organization_id = sale.organization_id AND store.id = sale.store_id
      WHERE ${where} ORDER BY sale.completed_at DESC, sale.id LIMIT ${limit} OFFSET ${offset}`, values);
  return {
    total, limit, offset,
    rows: rows.map((row) => ({
      id: row.id, receiptNumber: row.receipt_number, completedAt: row.completed_at, outlet: { code: row.store_code, name: row.store_name }, currency: String(row.currency_code ?? "").trim(),
      total: row.grand_total, paymentStatus: Number(row.paid_total) >= Number(row.grand_total) ? "paid" : "partially_paid",
      paymentMethods: row.methods ? row.methods.split(",") : [], status: row.status, refunded: row.refunded,
    })),
  };
}
