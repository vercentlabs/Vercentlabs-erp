// The people at a company: one account has many contacts, with at most one
// optional primary contact. Contacts themselves are maintained by the
// Contacts operations; this file links them to the account and keeps the
// account-level roles (primary, decision maker, department).
import { CrmError } from "../data-management/errors.js";
import { crmContactAccessSql } from "../data-management/crm-access-scope.js";
import { createCrmContact } from "../master-data/contact-operations.js";
import { canViewSensitiveAccountContent, requireAccountPermission } from "./access.js";
import { ACCOUNT_PERMISSIONS } from "./constants.js";
import { recordAccountHistory } from "./history.js";
import { getAccount, lockAccount } from "./records.js";
import { requireUuid } from "./validation.js";

const text = (value) => String(value ?? "").trim();
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function toContact(row, showContactDetails) {
  return {
    id: row.id,
    name: `${row.first_name} ${row.last_name ?? ""}`.trim(),
    firstName: row.first_name,
    lastName: row.last_name,
    jobTitle: row.designation,
    department: row.department,
    email: showContactDetails ? row.email : undefined,
    phone: showContactDetails ? row.mobile || row.phone : undefined,
    isPrimary: row.is_primary,
    isDecisionMaker: row.is_decision_maker,
    status: row.status,
  };
}

export async function listAccountContacts(client, context, partyId, { includeInactive = true } = {}) {
  const account = await getAccount(client, context, partyId);
  const { rows } = await client.query(
    `SELECT * FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2 AND ($3 OR status = 'active')
      ORDER BY status = 'active' DESC, is_primary DESC, is_decision_maker DESC, lower(first_name), lower(COALESCE(last_name, ''))`,
    [context.organizationId, account.id, includeInactive],
  );
  return rows.map((row) => toContact(row, canViewSensitiveAccountContent(context)));
}

function contactName(contact) {
  return `${contact.first_name} ${contact.last_name ?? ""}`.trim();
}

async function lockContact(client, context, contactId) {
  const values = [context.organizationId, requireUuid(contactId, "Contact")];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const { rows } = await client.query(
    `SELECT contact.* FROM tenant.contacts contact
       LEFT JOIN tenant.business_parties account ON account.organization_id = contact.organization_id AND account.id = contact.party_id
      WHERE contact.organization_id = $1 AND contact.id = $2${crmContactAccessSql(context, bind, "contact", "account")}
      FOR UPDATE OF contact`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Contact not found.", "CRM_CONTACT_NOT_FOUND");
  return rows[0];
}

// Creates a new contact at this company. input: the contact fields plus
// department and isDecisionMaker.
export async function createAccountContact(client, context, partyId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  if (account.status === "archived") throw new CrmError(409, "Reactivate this account before changing it.", "CRM_ACCOUNT_ARCHIVED");
  const { department, isDecisionMaker, makePrimary, ...contactInput } = input;
  const created = await createCrmContact(client, context, { ...contactInput, accountId: account.id });
  await client.query(`UPDATE tenant.contacts SET department = $3, is_decision_maker = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, created.id, text(department).slice(0, 160) || null, isDecisionMaker === true]);
  await recordAccountHistory(client, context, account.id, "contact_linked", `Contact ${`${text(input.firstName)} ${text(input.lastName)}`.trim()} added`, { contactId: created.id });
  if (makePrimary === true) await setPrimaryContact(client, context, account.id, created.id);
  return created;
}

// Links an existing contact (with no company, or at another company) to this account.
export async function linkContact(client, context, partyId, contactId) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  if (account.status === "archived") throw new CrmError(409, "Reactivate this account before changing it.", "CRM_ACCOUNT_ARCHIVED");
  const contact = await lockContact(client, context, contactId);
  if (contact.party_id === account.id) return { changed: false };
  const previousAccount = contact.party_id;
  await client.query(`UPDATE tenant.contacts SET party_id = $3, is_primary = false, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, contact.id, account.id, context.userId ?? null]);
  await recordAccountHistory(client, context, account.id, "contact_linked", `Contact ${contactName(contact)} linked`, { contactId: contact.id, fromAccount: previousAccount });
  if (previousAccount)
    await recordAccountHistory(client, context, previousAccount, "contact_unlinked", `Contact ${contactName(contact)} moved to ${account.display_name}`, { contactId: contact.id, toAccount: account.id });
  return { changed: true };
}

// The contact stays in CRM without a company.
export async function unlinkContact(client, context, partyId, contactId) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  const contact = await lockContact(client, context, contactId);
  if (contact.party_id !== account.id) throw new CrmError(409, "This contact is not linked to this account.", "CRM_ACCOUNT_CONTACT_NOT_LINKED");
  await client.query(`UPDATE tenant.contacts SET party_id = NULL, is_primary = false, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, contact.id, context.userId ?? null]);
  await recordAccountHistory(client, context, account.id, "contact_unlinked", `Contact ${contactName(contact)} unlinked`, { contactId: contact.id });
  return { changed: true };
}

// One optional primary contact per account; choosing another replaces it.
// contactId null clears the primary contact.
export async function setPrimaryContact(client, context, partyId, contactId) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  let contact = null;
  if (contactId) {
    contact = await lockContact(client, context, contactId);
    if (contact.party_id !== account.id) throw new CrmError(409, "This contact is not linked to this account.", "CRM_ACCOUNT_CONTACT_NOT_LINKED");
    if (contact.status !== "active") throw new CrmError(409, "An inactive contact cannot be the primary contact.", "CRM_ACCOUNT_CONTACT_INACTIVE");
    if (contact.is_primary) return { changed: false };
  }
  await client.query(`UPDATE tenant.contacts SET is_primary = false WHERE organization_id = $1 AND party_id = $2 AND is_primary`, [context.organizationId, account.id]);
  if (contact) await client.query(`UPDATE tenant.contacts SET is_primary = true, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, contact.id, context.userId ?? null]);
  await recordAccountHistory(client, context, account.id, "primary_contact_changed",
    contact ? `Primary contact: ${contactName(contact)}` : "Primary contact cleared", { contactId: contact?.id ?? null });
  return { changed: true };
}

// Department and decision-maker flag of a contact at this company.
export async function updateAccountContactRole(client, context, partyId, contactId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  const contact = await lockContact(client, context, contactId);
  if (contact.party_id !== account.id) throw new CrmError(409, "This contact is not linked to this account.", "CRM_ACCOUNT_CONTACT_NOT_LINKED");
  const department = has(input, "department") ? text(input.department).slice(0, 160) || null : contact.department;
  const isDecisionMaker = has(input, "isDecisionMaker") ? input.isDecisionMaker === true : contact.is_decision_maker;
  await client.query(`UPDATE tenant.contacts SET department = $3, is_decision_maker = $4, updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, contact.id, department, isDecisionMaker, context.userId ?? null]);
  return { changed: department !== contact.department || isDecisionMaker !== contact.is_decision_maker };
}

// Contacts that can be linked: those the caller can see that have no company
// or belong to another account. Used by the "Link existing contact" picker.
export async function searchLinkableContacts(client, context, partyId, search = "") {
  const account = await getAccount(client, context, partyId);
  const values = [context.organizationId, account.id, `%${text(search).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const { rows } = await client.query(
    `SELECT contact.id, contact.first_name, contact.last_name, contact.designation, other.display_name AS account_name
       FROM tenant.contacts contact
       LEFT JOIN tenant.business_parties other ON other.organization_id = contact.organization_id AND other.id = contact.party_id
       LEFT JOIN tenant.business_parties account ON account.organization_id = contact.organization_id AND account.id = contact.party_id
      WHERE contact.organization_id = $1 AND contact.status = 'active' AND contact.party_id IS DISTINCT FROM $2
        AND lower(contact.first_name || ' ' || COALESCE(contact.last_name, '') || ' ' || COALESCE(contact.email, '')) LIKE $3
        ${crmContactAccessSql(context, bind, "contact", "account")}
      ORDER BY lower(contact.first_name) LIMIT 20`,
    values,
  );
  return rows.map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name ?? ""}`.trim(), jobTitle: row.designation, accountName: row.account_name }));
}
