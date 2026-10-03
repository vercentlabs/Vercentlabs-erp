// Prospect -> customer. An account and its Customer Master are the same
// business party: "Create customer" gives the account a customer number and
// the commercial role Sales and Finance transact with, so there is never a
// second copy of the company to keep in sync. Commercial terms (payment
// terms, credit limit, GST) are captured here once and are maintained by
// Sales afterwards.
//
// "Link customer" is for a customer that already exists in Sales: the CRM
// account is merged into it, so the customer keeps its documents and gains
// the account's contacts, opportunities and history.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { requireAccountPermission } from "./access.js";
import { ACCOUNT_PERMISSIONS, CUSTOMER_NUMBER_DOCUMENT_TYPE } from "./constants.js";
import { recordAccountHistory } from "./history.js";
import { mergeAccounts } from "./merge.js";
import { getAccount, lockAccount } from "./records.js";
import { requireUuid } from "./validation.js";

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const text = (value) => String(value ?? "").trim();

function normalizeCommercialTerms(input) {
  const terms = {
    gstin: text(input.gstin).toUpperCase() || null,
    pan: text(input.pan).toUpperCase() || null,
    paymentTermId: text(input.paymentTermId) || null,
    creditLimit: input.creditLimit === undefined || input.creditLimit === null || input.creditLimit === "" ? null : Number(input.creditLimit),
    currencyCode: text(input.currencyCode).toUpperCase() || null,
  };
  const issues = [];
  if (terms.gstin && !GSTIN.test(terms.gstin)) issues.push({ field: "gstin", message: "Enter a valid 15-character GSTIN." });
  if (terms.pan && !PAN.test(terms.pan)) issues.push({ field: "pan", message: "Enter a valid 10-character PAN." });
  if (terms.gstin && terms.pan && terms.gstin.slice(2, 12) !== terms.pan) issues.push({ field: "pan", message: "The PAN does not match the GSTIN." });
  if (terms.creditLimit !== null && (!Number.isFinite(terms.creditLimit) || terms.creditLimit < 0)) issues.push({ field: "creditLimit", message: "Enter a credit limit of 0 or more." });
  if (terms.currencyCode && !/^[A-Z]{3}$/.test(terms.currencyCode)) issues.push({ field: "currencyCode", message: "Choose a currency." });
  if (terms.paymentTermId) requireUuid(terms.paymentTermId, "Payment terms");
  if (issues.length) throw new CrmError(400, issues[0].message, "CRM_ACCOUNT_CUSTOMER_VALIDATION", { issues });
  if (terms.gstin && !terms.pan) terms.pan = terms.gstin.slice(2, 12);
  return terms;
}

// What the Create customer form needs to know before it opens.
export async function customerReadiness(client, context, partyId) {
  const account = await getAccount(client, context, partyId);
  const addresses = await client.query(
    `SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'active' AND is_default_billing)::int AS billing
       FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2`,
    [context.organizationId, account.id],
  );
  const missing = [];
  if (account.isCustomer) missing.push("This account is already a customer.");
  if (account.status !== "active") missing.push("Only an active account can become a customer.");
  if (!addresses.rows[0].billing) missing.push("Add a billing address first.");
  return { account, ready: missing.length === 0, missing };
}

// input: { gstin?, pan?, paymentTermId?, creditLimit?, currencyCode? }
export async function createCustomerFromAccount(client, context, partyId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.createCustomer, "You do not have permission to create customers.");
  const account = await lockAccount(client, context, partyId);
  if (account.customer_number || ["customer", "both"].includes(account.party_type))
    throw new CrmError(409, "This account is already a customer.", "CRM_ACCOUNT_ALREADY_CUSTOMER");
  if (account.status !== "active") throw new CrmError(409, "Only an active account can become a customer.", "CRM_ACCOUNT_INACTIVE");
  const billing = await client.query(`SELECT 1 FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND is_default_billing`,
    [context.organizationId, account.id]);
  if (!billing.rows[0]) throw new CrmError(409, "Add a billing address before creating the customer.", "CRM_ACCOUNT_BILLING_ADDRESS_REQUIRED");

  const terms = normalizeCommercialTerms(input);
  if (terms.gstin) {
    const taken = await client.query(`SELECT code, display_name FROM tenant.business_parties WHERE organization_id = $1 AND gstin = $2 AND id <> $3`,
      [context.organizationId, terms.gstin, account.id]);
    if (taken.rows[0]) throw new CrmError(409, `This GSTIN already belongs to ${taken.rows[0].display_name} (${taken.rows[0].code}).`, "CRM_ACCOUNT_GSTIN_TAKEN");
  }
  if (terms.paymentTermId) {
    const term = await client.query(`SELECT status FROM tenant.payment_terms WHERE organization_id = $1 AND id = $2`, [context.organizationId, terms.paymentTermId]);
    if (term.rows[0]?.status !== "active") throw new CrmError(409, "Choose active payment terms.", "CRM_ACCOUNT_PAYMENT_TERMS_INVALID");
  }

  const customerNumber = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: CUSTOMER_NUMBER_DOCUMENT_TYPE });
  await client.query(
    `UPDATE tenant.business_parties
        SET party_type = 'customer', account_type = 'customer', customer_number = $3, customer_since = now(), customer_created_by = $4,
            gstin = COALESCE($5, gstin), pan = COALESCE($6, pan), payment_term_id = COALESCE($7, payment_term_id),
            credit_limit = COALESCE($8, credit_limit), currency_code = COALESCE($9, currency_code), updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, account.id, customerNumber, context.userId ?? null, terms.gstin, terms.pan, terms.paymentTermId, terms.creditLimit, terms.currencyCode],
  );
  await recordAccountHistory(client, context, account.id, "customer_created", `Customer ${customerNumber} created`, {
    customerNumber, from: account.account_type, to: "customer",
  });
  await queueOutboxEvent(client, context, "crm.accounts.customer_created", "account", account.id, { accountId: account.id, customerNumber });
  return getAccount(client, context, account.id);
}

// Customers the account could be linked to (for the picker): Sales customers
// with no CRM history of their own yet are listed first.
export async function searchLinkableCustomers(client, context, partyId, search = "") {
  const account = await getAccount(client, context, partyId);
  const { rows } = await client.query(
    `SELECT id, code, customer_number, display_name, gstin FROM tenant.business_parties
      WHERE organization_id = $1 AND id <> $2 AND status = 'active' AND (customer_number IS NOT NULL OR party_type IN ('customer', 'both'))
        AND lower(display_name || ' ' || code || ' ' || COALESCE(customer_number, '') || ' ' || COALESCE(gstin, '')) LIKE $3
      ORDER BY lower(display_name) LIMIT 20`,
    [context.organizationId, account.id, `%${text(search).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`],
  );
  return rows.map((row) => ({ id: row.id, code: row.code, customerNumber: row.customer_number, name: row.display_name, gstin: row.gstin }));
}

// Links this (prospect) account to an existing customer by merging it into
// the customer. input: { customerId, choices? } — choices as for a merge.
export async function linkCustomer(client, context, partyId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.createCustomer, "You do not have permission to link customers.");
  const customerId = requireUuid(input.customerId, "Customer");
  const account = await getAccount(client, context, partyId);
  if (account.isCustomer) throw new CrmError(409, "This account is already a customer.", "CRM_ACCOUNT_ALREADY_CUSTOMER");
  const customer = await getAccount(client, context, customerId);
  if (!customer.isCustomer) throw new CrmError(409, "Choose an existing customer.", "CRM_ACCOUNT_NOT_CUSTOMER");
  const result = await mergeAccounts(client, context, { keepId: customer.id, duplicateId: account.id, choices: input.choices }, { linkingCustomer: true });
  await recordAccountHistory(client, context, customer.id, "customer_linked", `CRM account ${account.displayName} (${account.code}) linked to this customer`, { accountId: account.id });
  return result;
}
