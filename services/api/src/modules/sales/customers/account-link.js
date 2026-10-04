// The CRM link. A CRM account and its customer are one business party, so an
// account has at most one customer and a customer at most one account:
//
//   createCustomerFromAccount — the account becomes the customer. Nothing is
//     copied; its addresses, contacts, opportunities and history are already
//     the customer's.
//   linkCustomerToAccount — for a customer that already exists: the prospect
//     account is merged into it, so there is still one record.
//
// A customer created in Sales without CRM is simply an account CRM can also
// see.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { linkCustomer } from "../../crm/accounts/customer.js";
import { recordAccountHistory } from "../../crm/accounts/history.js";
import { queueOutboxEvent } from "../../crm/data-management/outbox.js";
import { crmContext, requireCustomerPermission } from "./access.js";
import { toAddress } from "./addresses.js";
import { CUSTOMER_NUMBER_DOCUMENT_TYPE, CUSTOMER_PARTY_SQL, CUSTOMER_PERMISSIONS, CustomerError } from "./constants.js";
import { assertNoBlockingCustomerDuplicate, recordCustomerDuplicateOverride } from "./duplicates.js";
import { addInitialDetails, assertCustomerReferences, assertGstinFree, getCustomerUnscoped, loadCustomerRow, toCustomer } from "./records.js";
import { CUSTOMER_COLUMNS, assertValidCustomer, normalizeCustomerInput, requireUuid, text } from "./validation.js";

const NO_PERMISSION = "You do not have permission to create a customer from a CRM account.";

async function loadAccountRow(client, context, accountId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT account.*, owner.full_name AS owner_name FROM tenant.business_parties account LEFT JOIN public.users owner ON owner.id = account.owner_user_id
      WHERE account.organization_id = $1 AND account.id = $2 AND account.party_type <> 'supplier'${lock ? " FOR UPDATE OF account" : ""}`,
    [context.organizationId, requireUuid(accountId, "Account")],
  );
  if (!rows[0]) throw new CustomerError(404, "CRM account not found.", "SALES_CUSTOMER_ACCOUNT_NOT_FOUND");
  return rows[0];
}

const isCustomerRow = (row) => Boolean(row.customer_number) || ["customer", "both"].includes(row.party_type);

// CRM accounts that are not customers yet, for the "From CRM account" picker.
export async function searchAccountsForCustomer(client, context, search = "") {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.linkAccount, NO_PERMISSION);
  const { rows } = await client.query(
    `SELECT account.id, account.code, account.display_name, account.legal_name, owner.full_name AS owner_name
       FROM tenant.business_parties account LEFT JOIN public.users owner ON owner.id = account.owner_user_id
      WHERE account.organization_id = $1 AND account.party_type <> 'supplier' AND account.status = 'active' AND NOT ${CUSTOMER_PARTY_SQL("account")}
        AND lower(concat_ws(' ', account.code, account.display_name, account.legal_name)) LIKE $2
      ORDER BY lower(account.display_name) LIMIT 20`,
    [context.organizationId, `%${text(search).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`],
  );
  return rows.map((row) => ({ id: row.id, accountNumber: row.code, name: row.display_name, legalName: row.legal_name, ownerName: row.owner_name }));
}

// What the customer form starts with when it is opened from a CRM account.
export async function getCustomerPrefillFromAccount(client, context, accountId) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.linkAccount, NO_PERMISSION);
  const account = await loadAccountRow(client, context, accountId);
  const key = [context.organizationId, account.id];
  const addresses = (await client.query(`SELECT * FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' ORDER BY is_default_billing DESC, created_at`, key)).rows.map(toAddress);
  const contact = (await client.query(
    `SELECT COALESCE(NULLIF(contact.display_name, ''), btrim(contact.first_name || ' ' || COALESCE(contact.last_name, ''))) AS name, contact.email, COALESCE(contact.mobile, contact.phone) AS phone
       FROM tenant.crm_contact_account_relationships link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
      WHERE link.organization_id = $1 AND link.party_id = $2 AND link.status = 'active' ORDER BY link.is_primary_contact DESC, link.created_at LIMIT 1`, key)).rows[0] ?? null;
  const billing = addresses.find((address) => address.isDefaultBilling) ?? addresses[0] ?? null;
  return {
    account: { id: account.id, accountNumber: account.code, name: account.display_name, status: account.status, ownerName: account.owner_name },
    existingCustomer: isCustomerRow(account) ? { id: account.id, customerNumber: account.customer_number ?? account.code, name: account.display_name } : null,
    values: {
      displayName: account.display_name, legalName: account.legal_name, customerKind: account.customer_kind ?? "business", email: account.email, phone: account.phone,
      website: account.website, countryCode: account.country_code ?? billing?.countryCode ?? null, currencyCode: account.currency_code?.trim() ?? null,
      priceListId: account.default_price_list_id, paymentTermId: account.payment_term_id, gstRegistrationType: account.tax_treatment, gstin: account.gstin,
      placeOfSupply: account.place_of_supply ?? billing?.stateCode ?? null, ownerUserId: account.owner_user_id,
    },
    addresses,
    primaryContact: contact,
  };
}

// The account becomes the customer. input: the customer fields to set (they
// replace the account's), and optionally billingAddress / shippingAddress /
// primaryContact for an account that has none.
export async function createCustomerFromAccount(client, context, accountId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.linkAccount, NO_PERMISSION);
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.create, "You do not have permission to create customers.");
  const account = await loadAccountRow(client, context, accountId, { lock: true });
  if (isCustomerRow(account))
    throw new CustomerError(409, `This account is already customer ${account.customer_number ?? account.code}.`, "SALES_CUSTOMER_ACCOUNT_ALREADY_CUSTOMER", { customerId: account.id });
  if (account.status !== "active") throw new CustomerError(409, "Only an active account can become a customer.", "SALES_CUSTOMER_ACCOUNT_INACTIVE");

  const existing = toCustomer(account);
  const normalized = normalizeCustomerInput({ customerKind: existing.customerKind, ...input });
  assertValidCustomer(normalized, existing);
  await assertCustomerReferences(client, context, normalized);
  const merged = { ...existing, ...normalized };
  await assertGstinFree(client, context, merged.gstin, account.id);
  const duplicates = await assertNoBlockingCustomerDuplicate(client, context,
    { displayName: merged.displayName, legalName: merged.legalName, website: merged.website, email: merged.email, phone: merged.phone, gstin: merged.gstin },
    { excludeId: account.id, allowDuplicate: input.allowDuplicate === true, reason: input.duplicateReason });

  const customerNumber = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: CUSTOMER_NUMBER_DOCUMENT_TYPE });
  const sets = ["party_type = 'customer'", "account_type = 'customer'", "customer_number = $3", "customer_since = now()", "customer_created_by = $4", "updated_by = $4", "updated_at = now()"];
  const values = [context.organizationId, account.id, customerNumber, context.userId ?? null];
  for (const [field, column] of Object.entries(CUSTOMER_COLUMNS))
    if (normalized[field] !== undefined && String(normalized[field] ?? "") !== String(existing[field] ?? "")) { values.push(normalized[field]); sets.push(`${column} = $${values.length}`); }
  await client.query(`UPDATE tenant.business_parties SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`, values);
  await recordAccountHistory(client, context, account.id, "customer_created", `Customer ${customerNumber} created from this account`, { customerNumber, from: account.account_type, to: "customer", origin: text(input.origin) || "crm_account" });
  await recordCustomerDuplicateOverride(client, context, account.id, duplicates);
  await addInitialDetails(client, context, account.id, input, merged.displayName);
  await queueOutboxEvent(client, context, "crm.accounts.customer_created", "account", account.id, { accountId: account.id, customerNumber });
  return getCustomerUnscoped(client, context, account.id);
}

// Links a CRM account to a customer that already exists: the account is
// merged into the customer, which keeps its number and documents and gains
// the account's contacts, opportunities and history.
export async function linkCustomerToAccount(client, context, customerId, accountId) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.linkAccount, "You do not have permission to link a CRM account.");
  const customer = await loadCustomerRow(client, context, customerId);
  const account = await loadAccountRow(client, context, accountId);
  if (account.id === customer.id) throw new CustomerError(409, "This account is already this customer.", "SALES_CUSTOMER_ACCOUNT_ALREADY_CUSTOMER");
  if (isCustomerRow(account))
    throw new CustomerError(409, "That account is already a customer of its own. Two customers cannot be linked to each other.", "SALES_CUSTOMER_ACCOUNT_ALREADY_CUSTOMER", { customerId: account.id });
  try {
    await linkCustomer(client, crmContext(context), account.id, { customerId: customer.id });
  } catch (error) {
    if (String(error?.code ?? "").startsWith("CRM_ACCOUNT")) throw new CustomerError(error.status ?? 409, error.message, "SALES_CUSTOMER_ACCOUNT_LINK_BLOCKED", error.details);
    throw error;
  }
  return getCustomerUnscoped(client, context, customer.id);
}
