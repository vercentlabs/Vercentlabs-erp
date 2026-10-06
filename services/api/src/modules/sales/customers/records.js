// The customer record: create, read, list, update and delete. A customer is
// the same business party as its CRM account, so nothing is copied between
// CRM and Sales. Status changes live in lifecycle.js, addresses in
// addresses.js, contacts in contacts.js and the CRM link in account-link.js.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { recordAccountHistory } from "../../crm/accounts/history.js";
import { queueOutboxEvent } from "../../crm/data-management/outbox.js";
import { createContact } from "../../crm/contacts/records.js";
import { canViewCustomerFinancials, crmContext, customerCan, customerCapabilities, customerScopeSql, requireCustomerPermission } from "./access.js";
import { insertAddress } from "./addresses.js";
import {
  ACCOUNT_NUMBER_DOCUMENT_TYPE, CUSTOMER_NUMBER_DOCUMENT_TYPE, CUSTOMER_PARTY_SQL, CUSTOMER_PERMISSIONS, CUSTOMER_VIEWS, CustomerError,
  customerKindLabel, customerStatusLabel, gstRegistrationLabel, gstStateName,
} from "./constants.js";
import { assertNoBlockingCustomerDuplicate, recordCustomerDuplicateOverride } from "./duplicates.js";
import { CUSTOMER_COLUMNS, CUSTOMER_FIELD_LABELS, assertValidCustomer, has, isUuid, normalizeCustomerInput, requireUuid, text } from "./validation.js";

const OPEN_INVOICE = "('posted', 'partially_paid', 'overdue', 'disputed')";
const LIVE_RECEIPT = "('draft', 'cancelled', 'reversed')";
const num = (value) => (value === null || value === undefined ? null : Number(value));

// Receivable figures come from Accounting and are never stored on the customer.
const FINANCE_JOIN = `
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(invoice.outstanding_amount) FILTER (WHERE invoice.invoice_type <> 'credit_note' AND invoice.status IN ${OPEN_INVOICE}), 0) AS outstanding,
             COALESCE(sum(invoice.outstanding_amount) FILTER (WHERE invoice.invoice_type <> 'credit_note' AND invoice.status IN ${OPEN_INVOICE} AND invoice.due_date < current_date), 0) AS overdue
        FROM tenant.accounting_customer_invoices invoice
       WHERE invoice.organization_id = customer.organization_id AND invoice.party_id = customer.id) finance ON true`;

export function customerSelect({ finance = false } = {}) {
  return `
  SELECT customer.*, owner.full_name AS owner_name, creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         blocker.full_name AS blocked_by_name, status_actor.full_name AS status_changed_by_name,
         term.name AS payment_term_name, price_list.name AS price_list_name,
         billing.city AS billing_city, billing.state AS billing_state, billing.country_code AS billing_country_code,
         primary_contact.contact_id AS primary_contact_id, primary_contact.name AS primary_contact_name, primary_contact.phone AS primary_contact_phone,
         ${finance ? "finance.outstanding, finance.overdue" : "NULL::numeric AS outstanding, NULL::numeric AS overdue"}
    FROM tenant.business_parties customer
    LEFT JOIN public.users owner ON owner.id = customer.owner_user_id
    LEFT JOIN public.users creator ON creator.id = COALESCE(customer.customer_created_by, customer.created_by)
    LEFT JOIN public.users updater ON updater.id = customer.updated_by
    LEFT JOIN public.users blocker ON blocker.id = customer.sales_blocked_by
    LEFT JOIN public.users status_actor ON status_actor.id = customer.status_changed_by
    LEFT JOIN tenant.payment_terms term ON term.organization_id = customer.organization_id AND term.id = customer.payment_term_id
    LEFT JOIN tenant.price_lists price_list ON price_list.organization_id = customer.organization_id AND price_list.id = customer.default_price_list_id
    LEFT JOIN LATERAL (
      SELECT a.city, a.state, a.country_code FROM tenant.addresses a
       WHERE a.organization_id = customer.organization_id AND a.party_id = customer.id AND a.status = 'active'
       ORDER BY a.is_default_billing DESC, a.created_at LIMIT 1) billing ON true
    LEFT JOIN LATERAL (
      SELECT contact.id AS contact_id, COALESCE(NULLIF(contact.display_name, ''), btrim(contact.first_name || ' ' || COALESCE(contact.last_name, ''))) AS name,
             COALESCE(contact.mobile, contact.phone) AS phone
        FROM tenant.crm_contact_account_relationships link
        JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
       WHERE link.organization_id = customer.organization_id AND link.party_id = customer.id AND link.status = 'active' AND link.is_primary_contact
       LIMIT 1) primary_contact ON true${finance ? FINANCE_JOIN : ""}`;
}

// Active, Inactive or Blocked. An archived account is an inactive customer.
export const customerStatusOf = (row) => (row.status !== "active" ? "inactive" : row.sales_block !== "none" ? "blocked" : "active");

export function toCustomer(row, { finance = false } = {}) {
  const status = customerStatusOf(row);
  const customer = {
    id: row.id,
    customerNumber: row.customer_number ?? row.code,
    accountNumber: row.code,
    displayName: row.display_name,
    legalName: row.legal_name,
    customerKind: row.customer_kind ?? "business",
    customerKindLabel: customerKindLabel(row.customer_kind ?? "business"),
    status,
    statusLabel: customerStatusLabel(status),
    blockReason: status === "blocked" ? row.sales_block_reason : null,
    blockedAt: status === "blocked" ? row.sales_blocked_at : null,
    blockedByName: status === "blocked" ? row.blocked_by_name ?? null : null,
    statusReason: row.status_reason,
    statusChangedAt: row.status_changed_at,
    statusChangedByName: row.status_changed_by_name ?? null,
    email: row.email,
    phone: row.phone,
    website: row.website,
    countryCode: row.country_code ?? row.billing_country_code?.trim() ?? null,
    currencyCode: row.currency_code?.trim() ?? null,
    priceListId: row.default_price_list_id,
    priceListName: row.price_list_name ?? null,
    paymentTermId: row.payment_term_id,
    paymentTermName: row.payment_term_name ?? null,
    gstRegistrationType: row.tax_treatment,
    gstRegistrationLabel: row.tax_treatment ? gstRegistrationLabel(row.tax_treatment) : null,
    gstin: row.gstin,
    pan: row.pan,
    gstStateCode: row.gst_state_code,
    gstStateName: gstStateName(row.gst_state_code),
    placeOfSupply: row.place_of_supply,
    placeOfSupplyName: gstStateName(row.place_of_supply),
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? null,
    notes: row.customer_notes,
    primaryContactId: row.primary_contact_id ?? null,
    primaryContactName: row.primary_contact_name ?? null,
    primaryContactPhone: row.primary_contact_phone ?? null,
    city: row.billing_city ?? null,
    state: row.billing_state ?? null,
    customerSince: row.customer_since,
    createdByName: row.created_by_name ?? null,
    createdAt: row.customer_since ?? row.created_at,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
  };
  if (finance) {
    customer.outstanding = num(row.outstanding) ?? 0;
    customer.overdue = num(row.overdue) ?? 0;
  }
  return customer;
}

// ------------------------------------------------------------------ read

export async function loadCustomerRow(client, context, customerId, { lock = false, finance = false } = {}) {
  const values = [context.organizationId, requireUuid(customerId, "Customer")];
  const scope = customerScopeSql(context, values, "customer");
  const { rows } = await client.query(
    `${customerSelect({ finance })} WHERE customer.organization_id = $1 AND customer.id = $2 AND ${CUSTOMER_PARTY_SQL("customer")}${scope}${lock ? " FOR UPDATE OF customer" : ""}`,
    values,
  );
  if (!rows[0]) throw new CustomerError(404, "Customer not found.", "SALES_CUSTOMER_NOT_FOUND");
  return rows[0];
}

export async function getCustomer(client, context, customerId) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  const finance = canViewCustomerFinancials(context);
  return { ...toCustomer(await loadCustomerRow(client, context, customerId, { finance }), { finance }), capabilities: customerCapabilities(context) };
}

// ------------------------------------------------------------------ list

const SORT_COLUMNS = Object.freeze({
  customerNumber: "COALESCE(customer.customer_number, customer.code)",
  displayName: "lower(customer.display_name)",
  city: "lower(billing.city)",
  createdAt: "COALESCE(customer.customer_since, customer.created_at)",
  updatedAt: "customer.updated_at",
  outstanding: "finance.outstanding",
});

const ACTIVE_SQL = "customer.status = 'active' AND customer.sales_block = 'none'";
const VIEW_SQL = Object.freeze({
  active: ACTIVE_SQL,
  inactive: "customer.status <> 'active'",
  blocked: "customer.status = 'active' AND customer.sales_block <> 'none'",
  recently_created: "COALESCE(customer.customer_since, customer.created_at) >= now() - interval '30 days'",
  with_outstanding: "finance.outstanding > 0",
  with_overdue: "finance.overdue > 0",
});

const yes = (value) => value === true || value === "true" || value === "yes" || value === "1";
const like = (value) => `%${text(value).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;

// Builds the WHERE clause shared by the list and the export.
export function buildCustomerListWhere(context, filters = {}) {
  const finance = canViewCustomerFinancials(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [`customer.organization_id = $1`, CUSTOMER_PARTY_SQL("customer")];
  const view = text(filters.view) || "all";
  const needsFinance = ["with_outstanding", "with_overdue"].includes(view) || yes(filters.hasOutstanding) || yes(filters.hasOverdue);
  if (needsFinance && !finance) throw new CustomerError(403, "You do not have permission to see customer balances.", "PERMISSION_DENIED");
  if (VIEW_SQL[view]) where.push(VIEW_SQL[view]);
  if (filters.status === "active") where.push(ACTIVE_SQL);
  else if (filters.status === "inactive") where.push(VIEW_SQL.inactive);
  else if (filters.status === "blocked") where.push(VIEW_SQL.blocked);
  if (text(filters.search)) {
    const term = bind(like(filters.search));
    where.push(`(lower(concat_ws(' ', customer.customer_number, customer.code, customer.display_name, customer.legal_name, customer.gstin, customer.phone, customer.email)) LIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.addresses a WHERE a.organization_id = customer.organization_id AND a.party_id = customer.id AND a.status = 'active' AND lower(a.city) LIKE ${term})
      OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
                  WHERE link.organization_id = customer.organization_id AND link.party_id = customer.id AND link.status = 'active'
                    AND lower(concat_ws(' ', contact.display_name, contact.first_name, contact.last_name, contact.email, contact.mobile, contact.phone)) LIKE ${term}))`);
  }
  if (text(filters.customerKind)) where.push(`COALESCE(customer.customer_kind, 'business') = ${bind(text(filters.customerKind))}`);
  if (filters.ownerUserId === "unassigned") where.push("customer.owner_user_id IS NULL");
  else if (isUuid(filters.ownerUserId)) where.push(`customer.owner_user_id = ${bind(filters.ownerUserId)}`);
  if (text(filters.state)) where.push(`lower(billing.state) = ${bind(text(filters.state).toLowerCase())}`);
  if (text(filters.countryCode)) where.push(`COALESCE(customer.country_code, btrim(billing.country_code)) = ${bind(text(filters.countryCode).toUpperCase())}`);
  if (text(filters.gstRegistrationType)) where.push(`customer.tax_treatment = ${bind(text(filters.gstRegistrationType))}`);
  if (text(filters.currencyCode)) where.push(`customer.currency_code = ${bind(text(filters.currencyCode).toUpperCase())}`);
  if (isUuid(filters.priceListId)) where.push(`customer.default_price_list_id = ${bind(filters.priceListId)}`);
  if (isUuid(filters.paymentTermId)) where.push(`customer.payment_term_id = ${bind(filters.paymentTermId)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(filters.createdFrom))) where.push(`COALESCE(customer.customer_since, customer.created_at) >= ${bind(text(filters.createdFrom))}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(filters.createdTo))) where.push(`COALESCE(customer.customer_since, customer.created_at) < ${bind(text(filters.createdTo))}::date + 1`);
  if (yes(filters.hasOutstanding)) where.push("finance.outstanding > 0");
  if (yes(filters.hasOverdue)) where.push("finance.overdue > 0");
  const scope = customerScopeSql(context, values, "customer");
  return { finance, values, sql: `WHERE ${where.join(" AND ")}${scope}` };
}

// filters: view, search, status, customerKind, ownerUserId, state,
// countryCode, gstRegistrationType, currencyCode, priceListId, paymentTermId,
// createdFrom, createdTo, hasOutstanding, hasOverdue, sort, direction, limit,
// offset.
export async function listCustomers(client, context, filters = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  const { finance, values, sql } = buildCustomerListWhere(context, filters);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sortKey = SORT_COLUMNS[filters.sort] && (filters.sort !== "outstanding" || finance) ? filters.sort : "createdAt";
  const direction = filters.direction === "asc" ? "ASC" : filters.direction === "desc" ? "DESC" : sortKey === "displayName" || sortKey === "city" ? "ASC" : "DESC";
  const { rows } = await client.query(
    `${customerSelect({ finance }).replace("SELECT customer.*", "SELECT count(*) OVER () AS total_count, customer.*")} ${sql}
      ORDER BY ${SORT_COLUMNS[sortKey]} ${direction} NULLS LAST, customer.id LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    customers: rows.map((row) => toCustomer(row, { finance })),
    total: Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
    views: CUSTOMER_VIEWS.filter((view) => !view.finance || finance).map(({ key, label }) => ({ key, label })),
    showsFinancials: finance,
    capabilities: customerCapabilities(context),
  };
}

// A short list for pickers (the quotation form, linking an account).
export async function searchCustomers(client, context, search = "", { limit = 20 } = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  const values = [context.organizationId, like(search)];
  const { rows } = await client.query(
    `SELECT customer.id, customer.customer_number, customer.code, customer.display_name, customer.gstin, customer.status, customer.sales_block
       FROM tenant.business_parties customer
      WHERE customer.organization_id = $1 AND ${CUSTOMER_PARTY_SQL("customer")} AND customer.status <> 'archived'
        AND lower(concat_ws(' ', customer.customer_number, customer.code, customer.display_name, customer.legal_name, customer.gstin)) LIKE $2${customerScopeSql(context, values, "customer")}
      ORDER BY lower(customer.display_name) LIMIT ${Math.min(Math.max(Number(limit) || 20, 1), 50)}`,
    values,
  );
  return rows.map((row) => ({ id: row.id, customerNumber: row.customer_number ?? row.code, displayName: row.display_name, gstin: row.gstin, status: customerStatusOf(row) }));
}

// ------------------------------------------------------------------ write

// The price list, payment terms, currency and salesperson must exist and be usable.
export async function assertCustomerReferences(client, context, normalized) {
  const organizationId = context.organizationId;
  const one = async (sql, value) => (await client.query(sql, [organizationId, value])).rows[0];
  if (normalized.currencyCode && !(await one(`SELECT 1 FROM tenant.currencies WHERE organization_id = $1 AND code = $2 AND status = 'active'`, normalized.currencyCode)))
    throw new CustomerError(400, "Choose a currency your organization uses.", "SALES_CUSTOMER_VALIDATION", { issues: [{ field: "currencyCode", message: "Choose a currency your organization uses." }] });
  if (normalized.priceListId && !(await one(`SELECT 1 FROM tenant.price_lists WHERE organization_id = $1 AND id = $2 AND price_list_type = 'sales' AND status = 'active'`, normalized.priceListId)))
    throw new CustomerError(400, "Choose an active sales price list.", "SALES_CUSTOMER_VALIDATION", { issues: [{ field: "priceListId", message: "Choose an active sales price list." }] });
  if (normalized.paymentTermId && !(await one(`SELECT 1 FROM tenant.payment_terms WHERE organization_id = $1 AND id = $2 AND status = 'active' AND is_sales_enabled`, normalized.paymentTermId)))
    throw new CustomerError(400, "Choose active payment terms.", "SALES_CUSTOMER_VALIDATION", { issues: [{ field: "paymentTermId", message: "Choose active payment terms." }] });
  if (normalized.ownerUserId && !(await one(
    `SELECT 1 FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND membership.status = 'active' AND users.status = 'active'`, normalized.ownerUserId)))
    throw new CustomerError(400, "Choose an active user as the salesperson.", "SALES_CUSTOMER_VALIDATION", { issues: [{ field: "ownerUserId", message: "Choose an active user as the salesperson." }] });
}

export async function assertGstinFree(client, context, gstin, exceptId = null) {
  if (!gstin) return;
  const { rows } = await client.query(
    `SELECT id, code, customer_number, display_name FROM tenant.business_parties WHERE organization_id = $1 AND upper(gstin) = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [context.organizationId, gstin, exceptId],
  );
  if (rows[0])
    throw new CustomerError(409, `This GSTIN already belongs to ${rows[0].display_name} (${rows[0].customer_number ?? rows[0].code}).`, "SALES_CUSTOMER_GSTIN_TAKEN",
      { issues: [{ field: "gstin", message: "This GSTIN already belongs to another customer." }], matchedRecordId: rows[0].id });
}

const duplicateProbe = (customer, city = null) => ({
  displayName: customer.displayName, legalName: customer.legalName, website: customer.website, email: customer.email, phone: customer.phone, gstin: customer.gstin, city,
});

// The addresses and the primary contact given with a new customer.
export async function addInitialDetails(client, context, partyId, input, displayName) {
  const billing = input.billingAddress && text(input.billingAddress.line1) ? input.billingAddress : null;
  const shipping = input.shippingAddress && text(input.shippingAddress.line1) ? input.shippingAddress : null;
  if (billing)
    await insertAddress(client, context, partyId, { addressType: "billing", ...billing, isDefaultBilling: true, isDefaultShipping: !shipping });
  if (shipping) await insertAddress(client, context, partyId, { addressType: "shipping", ...shipping, isDefaultBilling: !billing, isDefaultShipping: true });
  const contact = input.primaryContact && text(input.primaryContact.firstName) ? input.primaryContact : null;
  if (contact) {
    const created = await createContact(client, crmContext(context), {
      firstName: contact.firstName, lastName: contact.lastName, email: contact.email, mobile: contact.phone, jobTitle: contact.jobTitle, accountId: partyId,
    }, { origin: "account", makePrimary: true, allowDuplicate: true, duplicateReason: `Primary contact of customer ${displayName}` });
    await client.query(
      `UPDATE tenant.crm_contact_account_relationships SET is_billing_contact = true, is_shipping_contact = true WHERE organization_id = $1 AND party_id = $2 AND contact_id = $3`,
      [context.organizationId, partyId, created.id],
    );
  }
}

// input: the customer fields, plus status ("active" | "inactive"),
// billingAddress, shippingAddress, primaryContact, and allowDuplicate +
// duplicateReason to save despite a strong match.
export async function createCustomer(client, context, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.create, "You do not have permission to create customers.");
  const normalized = normalizeCustomerInput({ customerKind: "business", ...input });
  if (!has(input, "ownerUserId")) normalized.ownerUserId = context.userId ?? null;
  assertValidCustomer(normalized);
  const status = text(input.status) || "active";
  if (!["active", "inactive"].includes(status))
    throw new CustomerError(400, "A new customer is Active or Inactive.", "SALES_CUSTOMER_VALIDATION", { issues: [{ field: "status", message: "Choose Active or Inactive." }] });
  await assertCustomerReferences(client, context, normalized);
  await assertGstinFree(client, context, normalized.gstin);
  const duplicates = await assertNoBlockingCustomerDuplicate(client, context, duplicateProbe(normalized, input.billingAddress?.city), {
    allowDuplicate: input.allowDuplicate === true, reason: input.duplicateReason,
  });
  if (!normalized.placeOfSupply) normalized.placeOfSupply = normalized.gstStateCode ?? (text(input.billingAddress?.stateCode) || null);

  const numbering = { organizationId: context.organizationId };
  const code = await nextDocumentNumber(client, numbering, { documentType: ACCOUNT_NUMBER_DOCUMENT_TYPE });
  const customerNumber = await nextDocumentNumber(client, numbering, { documentType: CUSTOMER_NUMBER_DOCUMENT_TYPE });
  const columns = ["organization_id", "code", "party_type", "account_type", "status", "customer_number", "customer_since", "customer_created_by", "created_by", "updated_by", "assigned_at"];
  const values = [context.organizationId, code, "customer", "customer", status, customerNumber, new Date(), context.userId ?? null, context.userId ?? null, context.userId ?? null,
    normalized.ownerUserId ? new Date() : null];
  for (const [field, column] of Object.entries(CUSTOMER_COLUMNS))
    if (normalized[field] !== null && normalized[field] !== undefined) { columns.push(column); values.push(normalized[field]); }
  const { rows } = await client.query(
    `INSERT INTO tenant.business_parties (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
    values,
  );
  const partyId = rows[0].id;
  await recordAccountHistory(client, context, partyId, "customer_created", `Customer ${customerNumber} created`, { customerNumber, origin: text(input.origin) || "sales" });
  await recordCustomerDuplicateOverride(client, context, partyId, duplicates);
  await addInitialDetails(client, context, partyId, input, normalized.displayName);
  await queueOutboxEvent(client, context, "crm.accounts.customer_created", "account", partyId, { accountId: partyId, customerNumber });
  return getCustomerUnscoped(client, context, partyId);
}

// The creator sees the customer they just saved even if it was assigned to
// someone outside their visibility.
export async function getCustomerUnscoped(client, context, partyId) {
  const finance = canViewCustomerFinancials(context);
  const { rows } = await client.query(`${customerSelect({ finance })} WHERE customer.organization_id = $1 AND customer.id = $2`, [context.organizationId, partyId]);
  return { ...toCustomer(rows[0], { finance }), capabilities: customerCapabilities(context) };
}

// Fields a change needs more than "edit" for.
const SENSITIVE = Object.freeze({
  gstin: [CUSTOMER_PERMISSIONS.editGstin, "You do not have permission to change GST details."],
  pan: [CUSTOMER_PERMISSIONS.editGstin, "You do not have permission to change GST details."],
  gstRegistrationType: [CUSTOMER_PERMISSIONS.editGstin, "You do not have permission to change GST details."],
  gstStateCode: [CUSTOMER_PERMISSIONS.editGstin, "You do not have permission to change GST details."],
  placeOfSupply: [CUSTOMER_PERMISSIONS.editGstin, "You do not have permission to change GST details."],
  currencyCode: [CUSTOMER_PERMISSIONS.changeCurrency, "You do not have permission to change the customer's currency."],
  paymentTermId: [CUSTOMER_PERMISSIONS.changePaymentTerms, "You do not have permission to change payment terms."],
  priceListId: [CUSTOMER_PERMISSIONS.changePriceList, "You do not have permission to change the price list."],
});
const NAMED = Object.freeze({ priceListId: "priceListName", paymentTermId: "paymentTermName", ownerUserId: "ownerName", gstRegistrationType: "gstRegistrationLabel", customerKind: "customerKindLabel" });
const IDENTITY = ["displayName", "legalName", "website", "gstin"];

// Changes the customer's own fields. Documents already issued keep the
// values they were created with: they hold their own snapshot.
export async function updateCustomer(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.edit, "You do not have permission to edit customers.");
  for (const field of ["status", "customerNumber", "blockReason"])
    if (has(input, field)) throw new CustomerError(409, "Use Inactivate, Reactivate, Block or Unblock to change the status.", "SALES_CUSTOMER_FIELD_GOVERNED");
  const row = await loadCustomerRow(client, context, customerId, { lock: true });
  const before = toCustomer(row);
  const normalized = normalizeCustomerInput(input);
  const changed = Object.keys(CUSTOMER_COLUMNS).filter((field) => has(normalized, field) && String(normalized[field] ?? "") !== String(before[field] ?? ""));
  // A customer that has no country yet takes the one being validated against.
  assertValidCustomer(Object.fromEntries(changed.map((field) => [field, normalized[field]])), before);
  for (const field of changed) if (SENSITIVE[field]) requireCustomerPermission(context, ...SENSITIVE[field]);
  const next = Object.fromEntries(changed.map((field) => [field, normalized[field]]));
  await assertCustomerReferences(client, context, next);
  if (changed.includes("gstin")) await assertGstinFree(client, context, next.gstin, row.id);
  // Only what changed is matched: an identity the customer already had was
  // accepted when it was saved.
  let duplicates = null;
  const identity = Object.fromEntries(changed.filter((field) => IDENTITY.includes(field)).map((field) => [field, next[field]]));
  if (Object.keys(identity).length)
    duplicates = await assertNoBlockingCustomerDuplicate(client, context, duplicateProbe(identity, before.city), {
      excludeId: row.id, allowDuplicate: input.allowDuplicate === true, reason: input.duplicateReason,
    });

  const sets = ["updated_by = $3", "updated_at = now()"];
  const values = [context.organizationId, row.id, context.userId ?? null];
  for (const field of changed) { values.push(next[field]); sets.push(`${CUSTOMER_COLUMNS[field]} = $${values.length}`); }
  if (changed.includes("ownerUserId")) sets.push("assigned_at = now()");
  // A customer created before customer numbers existed gets one now.
  if (!row.customer_number) {
    values.push(await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: CUSTOMER_NUMBER_DOCUMENT_TYPE }));
    sets.push(`customer_number = $${values.length}`, "customer_since = COALESCE(customer_since, created_at)", "customer_kind = COALESCE(customer_kind, 'business')");
  }
  if (!changed.length && row.customer_number) return getCustomer(client, context, row.id);
  await client.query(`UPDATE tenant.business_parties SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`, values);
  const after = await getCustomerUnscoped(client, context, row.id);
  if (changed.length) {
    const changes = Object.fromEntries(changed.map((field) => {
      const shown = NAMED[field] ?? field;
      return [field, { label: CUSTOMER_FIELD_LABELS[field], from: before[shown] ?? null, to: after[shown] ?? null }];
    }));
    await recordAccountHistory(client, context, row.id, "updated", `${changed.map((field) => CUSTOMER_FIELD_LABELS[field]).join(", ")} changed`, changes);
    await recordCustomerDuplicateOverride(client, context, row.id, duplicates);
  }
  return after;
}

// ------------------------------------------------------------------ delete

const TRANSACTIONS = Object.freeze([
  ["quotations", "SELECT 1 FROM tenant.sales_quotations WHERE organization_id = $1 AND party_id = $2"],
  ["sales orders", "SELECT 1 FROM tenant.sales_orders WHERE organization_id = $1 AND party_id = $2"],
  ["invoices", "SELECT 1 FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND party_id = $2"],
  ["payments", "SELECT 1 FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND party_id = $2"],
  ["supplier bills", "SELECT 1 FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND party_id = $2"],
  ["journal entries", "SELECT 1 FROM tenant.accounting_journal_lines WHERE organization_id = $1 AND party_id = $2"],
  ["POS sales", "SELECT 1 FROM tenant.pos_sales WHERE organization_id = $1 AND customer_id = $2"],
  ["projects", "SELECT 1 FROM tenant.projects WHERE organization_id = $1 AND customer_id = $2"],
  ["support tickets", "SELECT 1 FROM tenant.support_tickets WHERE organization_id = $1 AND customer_id = $2"],
  ["opportunities", "SELECT 1 FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2"],
  ["converted leads", "SELECT 1 FROM tenant.crm_leads WHERE organization_id = $1 AND converted_party_id = $2"],
]);

export async function customerTransactions(client, context, partyId) {
  const found = [];
  for (const [label, sql] of TRANSACTIONS) if ((await client.query(`${sql} LIMIT 1`, [context.organizationId, partyId])).rows[0]) found.push(label);
  return found;
}

// Permanently removes a customer created by mistake. A customer with any
// transaction or CRM history is inactivated instead.
export async function deleteCustomer(client, context, customerId) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.delete, "You do not have permission to delete customers.");
  const row = await loadCustomerRow(client, context, customerId, { lock: true });
  const transactions = await customerTransactions(client, context, row.id);
  if (transactions.length)
    throw new CustomerError(409, `This customer has ${transactions.join(", ")}. Inactivate it instead of deleting it.`, "SALES_CUSTOMER_IN_USE", { references: transactions });
  await client.query("SAVEPOINT customer_delete");
  try {
    const key = [context.organizationId, row.id];
    // The people stay as CRM contacts; the customer's addresses and history go with it.
    await client.query(`DELETE FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND party_id = $2`, key);
    await client.query(`UPDATE tenant.contacts SET party_id = NULL WHERE organization_id = $1 AND party_id = $2`, key);
    await client.query(`DELETE FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, key);
    await client.query("RELEASE SAVEPOINT customer_delete");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT customer_delete");
    if (error?.code === "23503" || error?.code === "P0001")
      throw new CustomerError(409, "This customer is used by other records. Inactivate it instead of deleting it.", "SALES_CUSTOMER_IN_USE");
    throw error;
  }
  return { deleted: true };
}

export { customerCan };
