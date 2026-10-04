// The people at a company and the companies of a person. Every link is a row
// in crm_contact_account_relationships with its own job title, department,
// role, decision-maker flag and active/inactive state. One active link is the
// person's primary company; one active person per account is that account's
// primary contact. Ending a link (the person left) keeps it as history.
//
// The account screens use the account-side functions (listAccountContacts,
// linkContact, setPrimaryContact, …); the contact screens use the
// contact-side ones (listContactAccounts, linkContactToAccount, …). Both
// change the same rows.
import { accountScopeSql } from "../accounts/access.js";
import { recordAccountHistory } from "../accounts/history.js";
import { CrmError } from "../data-management/errors.js";
import { canViewSensitiveContactContent, contactCan, contactScopeValues } from "./access.js";
import { CONTACT_PERMISSIONS, CONTACT_ROLES } from "./constants.js";
import { recordContactHistory } from "./history.js";
import { createContact, loadLinkableAccount, lockContact } from "./records.js";
import { requireUuid } from "./validation.js";

const ROLES = new Set(CONTACT_ROLES.map((entry) => entry.code));
const text = (value) => String(value ?? "").trim();
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const nameOf = (contact) => contact.display_name || `${contact.first_name} ${contact.last_name ?? ""}`.trim();

// Linking people and companies is editing either side.
function requireRelationshipPermission(context) {
  if (!contactCan(context, CONTACT_PERMISSIONS.edit) && !contactCan(context, "crm.accounts.edit"))
    throw new CrmError(403, "You do not have permission to change who works where.", "PERMISSION_DENIED");
}

function relationshipFields(input) {
  const fields = {};
  if (has(input, "jobTitle")) fields.job_title = text(input.jobTitle).slice(0, 160) || null;
  if (has(input, "department")) fields.department = text(input.department).slice(0, 160) || null;
  if (has(input, "role")) {
    fields.role = text(input.role).toLowerCase() || null;
    if (fields.role && !ROLES.has(fields.role)) throw new CrmError(400, "Choose a contact role.", "CRM_CONTACT_VALIDATION");
  }
  if (has(input, "isDecisionMaker")) fields.is_decision_maker = input.isDecisionMaker === true;
  return fields;
}

async function relationshipOf(client, context, contactId, partyId) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND contact_id = $2 AND party_id = $3 FOR UPDATE`,
    [context.organizationId, contactId, partyId],
  );
  return rows[0] ?? null;
}

// The account row the caller can see (archived allowed for reads/unlinks).
async function visibleAccount(client, context, accountId) {
  const values = [context.organizationId, requireUuid(accountId, "Account")];
  const { rows } = await client.query(
    `SELECT account.id, account.display_name, account.status FROM tenant.business_parties account
      WHERE account.organization_id = $1 AND account.id = $2 AND account.party_type <> 'supplier'${accountScopeSql(context, values, "account")}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Account not found.", "CRM_ACCOUNT_NOT_FOUND");
  return rows[0];
}

// Makes the next active company primary when the primary one ends.
async function promoteNextPrimaryAccount(client, context, contactId) {
  const current = await client.query(
    `SELECT 1 FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND contact_id = $2 AND is_primary_account`, [context.organizationId, contactId]);
  if (current.rows[0]) return;
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships SET is_primary_account = true
      WHERE id = (SELECT id FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND contact_id = $2 AND status = 'active'
                   ORDER BY updated_at DESC LIMIT 1)`,
    [context.organizationId, contactId],
  );
}

// ------------------------------------------------------------------ contact side

export async function listContactAccounts(client, context, contactId) {
  const contact = await lockContact(client, context, contactId, { lock: false });
  const { rows } = await client.query(
    `SELECT r.*, account.display_name AS account_name, account.code AS account_code, account.account_type, account.status AS account_status
       FROM tenant.crm_contact_account_relationships r
       JOIN tenant.business_parties account ON account.organization_id = r.organization_id AND account.id = r.party_id
      WHERE r.organization_id = $1 AND r.contact_id = $2
      ORDER BY r.status = 'active' DESC, r.is_primary_account DESC, r.updated_at DESC`,
    [context.organizationId, contact.id],
  );
  return rows.map((row) => ({
    id: row.id, accountId: row.party_id, accountName: row.account_name, accountCode: row.account_code, accountType: row.account_type, accountStatus: row.account_status,
    jobTitle: row.job_title, department: row.department, role: row.role, isPrimaryAccount: row.is_primary_account, isPrimaryContact: row.is_primary_contact,
    isDecisionMaker: row.is_decision_maker, status: row.status, endedAt: row.ended_at, createdAt: row.created_at,
  }));
}

// input: { accountId, jobTitle?, department?, role?, isDecisionMaker?, makePrimaryAccount? }
// Links the person to a company, or brings back an ended link.
export async function linkContactToAccount(client, context, contactId, input = {}) {
  requireRelationshipPermission(context);
  const contact = await lockContact(client, context, contactId);
  if (contact.status === "archived") throw new CrmError(409, "Reactivate this contact before changing it.", "CRM_CONTACT_ARCHIVED");
  const account = await loadLinkableAccount(client, context, input.accountId);
  const fields = relationshipFields(input);
  const existing = await relationshipOf(client, context, contact.id, account.id);
  const makePrimary = input.makePrimaryAccount === true || !contact.party_id;
  if (existing?.status === "active" && !makePrimary && !Object.keys(fields).length) return { changed: false };
  if (makePrimary)
    await client.query(`UPDATE tenant.crm_contact_account_relationships SET is_primary_account = false WHERE organization_id = $1 AND contact_id = $2 AND is_primary_account AND party_id <> $3`,
      [context.organizationId, contact.id, account.id]);
  if (existing) {
    const assignments = Object.entries({ ...fields, status: "active", ended_at: null, ...(makePrimary ? { is_primary_account: true } : {}) });
    await client.query(
      `UPDATE tenant.crm_contact_account_relationships SET ${assignments.map(([column], index) => `${column} = $${index + 2}`).join(", ")}, updated_by = $${assignments.length + 2}
        WHERE id = $1`,
      [existing.id, ...assignments.map(([, value]) => value), context.userId ?? null],
    );
  } else {
    await client.query(
      `INSERT INTO tenant.crm_contact_account_relationships (organization_id, contact_id, party_id, job_title, department, role, is_decision_maker, is_primary_account, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [context.organizationId, contact.id, account.id, fields.job_title ?? (makePrimary ? contact.designation : null), fields.department ?? (makePrimary ? contact.department : null),
        fields.role ?? (makePrimary ? contact.contact_role : null), fields.is_decision_maker ?? false, makePrimary, context.userId ?? null],
    );
  }
  const previous = contact.party_id && contact.party_id !== account.id ? contact.account_name : null;
  await recordContactHistory(client, context, contact.id, makePrimary && previous ? "account_changed" : "account_linked",
    makePrimary && previous ? `Company: ${previous} → ${account.display_name}` : `Linked to ${account.display_name}`, { accountId: account.id, from: contact.party_id });
  await recordAccountHistory(client, context, account.id, "contact_linked", `Contact ${nameOf(contact)} linked`, { contactId: contact.id });
  return { changed: true };
}

// input: { jobTitle?, department?, role?, isDecisionMaker?, status? (active | inactive) }
export async function updateContactRelationship(client, context, contactId, accountId, input = {}) {
  requireRelationshipPermission(context);
  const contact = await lockContact(client, context, contactId);
  const account = await visibleAccount(client, context, accountId);
  const relationship = await relationshipOf(client, context, contact.id, account.id);
  if (!relationship) throw new CrmError(404, "This contact is not linked to this account.", "CRM_ACCOUNT_CONTACT_NOT_LINKED");
  const fields = relationshipFields(input);
  if (has(input, "status")) {
    if (!["active", "inactive"].includes(input.status)) throw new CrmError(400, "Choose active or inactive.", "CRM_CONTACT_VALIDATION");
    fields.status = input.status;
    fields.ended_at = input.status === "inactive" ? new Date().toISOString() : null;
    // An ended link holds no role at the company, including the Customer
    // Master's billing and delivery contact.
    if (input.status === "inactive") Object.assign(fields, { is_primary_account: false, is_primary_contact: false, is_billing_contact: false, is_shipping_contact: false, is_procurement_contact: false });
  }
  const assignments = Object.entries(fields);
  if (!assignments.length) return { changed: false };
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships SET ${assignments.map(([column], index) => `${column} = $${index + 2}`).join(", ")}, updated_by = $${assignments.length + 2}
      WHERE id = $1`,
    [relationship.id, ...assignments.map(([, value]) => value), context.userId ?? null],
  );
  if (fields.status === "inactive") await promoteNextPrimaryAccount(client, context, contact.id);
  const changes = Object.fromEntries(assignments.map(([column, value]) => [column, { from: relationship[column] ?? null, to: value }]));
  await recordContactHistory(client, context, contact.id, "relationship_updated",
    fields.status === "inactive" ? `No longer at ${account.display_name}` : `Role at ${account.display_name} updated`, { accountId: account.id, ...changes });
  if (fields.status === "inactive") await recordAccountHistory(client, context, account.id, "contact_unlinked", `Contact ${nameOf(contact)} no longer here`, { contactId: contact.id });
  return { changed: true };
}

// Ends the link; the history stays. A person who ends their last link is a
// contact without a company.
export async function unlinkContactFromAccount(client, context, contactId, accountId) {
  return updateContactRelationship(client, context, contactId, accountId, { status: "inactive" });
}

// Changes which of the person's companies is the primary one.
export async function setPrimaryAccount(client, context, contactId, accountId) {
  requireRelationshipPermission(context);
  const contact = await lockContact(client, context, contactId);
  const account = await visibleAccount(client, context, accountId);
  const relationship = await relationshipOf(client, context, contact.id, account.id);
  if (!relationship || relationship.status !== "active") throw new CrmError(409, "Link the contact to this account first.", "CRM_ACCOUNT_CONTACT_NOT_LINKED");
  if (relationship.is_primary_account) return { changed: false };
  await client.query(`UPDATE tenant.crm_contact_account_relationships SET is_primary_account = false WHERE organization_id = $1 AND contact_id = $2 AND is_primary_account`,
    [context.organizationId, contact.id]);
  await client.query(`UPDATE tenant.crm_contact_account_relationships SET is_primary_account = true, updated_by = $2 WHERE id = $1`, [relationship.id, context.userId ?? null]);
  await recordContactHistory(client, context, contact.id, "account_changed", `Company: ${contact.account_name ?? "None"} → ${account.display_name}`, { from: contact.party_id, to: account.id });
  return { changed: true };
}

// ------------------------------------------------------------------ account side

function toAccountContact(row, showDetails) {
  return {
    id: row.contact_id,
    relationshipId: row.id,
    contactNumber: row.contact_number,
    name: row.display_name || `${row.first_name} ${row.last_name ?? ""}`.trim(),
    firstName: row.first_name,
    lastName: row.last_name,
    jobTitle: row.job_title,
    department: row.department,
    role: row.role,
    email: showDetails ? row.email : undefined,
    phone: showDetails ? row.mobile || row.phone : undefined,
    isPrimary: row.is_primary_contact,
    isPrimaryAccount: row.is_primary_account,
    isDecisionMaker: row.is_decision_maker,
    relationshipStatus: row.status,
    status: row.status === "active" ? row.contact_status : "inactive",
  };
}

export async function listAccountContacts(client, context, partyId, { includeInactive = true } = {}) {
  const account = await visibleAccount(client, context, partyId);
  const { rows } = await client.query(
    `SELECT r.*, contact.contact_number, contact.display_name, contact.first_name, contact.last_name, contact.email, contact.mobile, contact.phone,
            contact.status AS contact_status
       FROM tenant.crm_contact_account_relationships r
       JOIN tenant.contacts contact ON contact.organization_id = r.organization_id AND contact.id = r.contact_id
      WHERE r.organization_id = $1 AND r.party_id = $2 AND ($3 OR r.status = 'active') AND contact.status <> 'archived'
      ORDER BY r.status = 'active' DESC, r.is_primary_contact DESC, r.is_decision_maker DESC, lower(contact.first_name), lower(COALESCE(contact.last_name, ''))`,
    [context.organizationId, account.id, includeInactive],
  );
  return rows.map((row) => toAccountContact(row, canViewSensitiveContactContent(context)));
}

// A new person at this company. input: the contact fields plus jobTitle,
// department, role, isDecisionMaker and makePrimary.
export async function createAccountContact(client, context, partyId, input = {}) {
  const { makePrimary, allowDuplicate, ...fields } = input;
  return createContact(client, context, { ...fields, accountId: partyId }, { origin: "account", makePrimary: makePrimary === true, allowDuplicate: allowDuplicate === true });
}

export async function linkContact(client, context, partyId, contactId) {
  return linkContactToAccount(client, context, contactId, { accountId: partyId });
}

export async function unlinkContact(client, context, partyId, contactId) {
  return unlinkContactFromAccount(client, context, contactId, partyId);
}

// The account's one primary contact; choosing another keeps the previous
// person as an ordinary contact. contactId null clears it.
export async function setPrimaryContact(client, context, partyId, contactId) {
  requireRelationshipPermission(context);
  const account = await visibleAccount(client, context, partyId);
  let relationship = null;
  let contact = null;
  if (contactId) {
    contact = await lockContact(client, context, contactId);
    relationship = await relationshipOf(client, context, contact.id, account.id);
    if (!relationship || relationship.status !== "active") throw new CrmError(409, "This contact is not linked to this account.", "CRM_ACCOUNT_CONTACT_NOT_LINKED");
    if (contact.status !== "active") throw new CrmError(409, "An inactive contact cannot be the primary contact.", "CRM_ACCOUNT_CONTACT_INACTIVE");
    if (relationship.is_primary_contact) return { changed: false };
  }
  await client.query(`UPDATE tenant.crm_contact_account_relationships SET is_primary_contact = false WHERE organization_id = $1 AND party_id = $2 AND is_primary_contact`,
    [context.organizationId, account.id]);
  if (relationship) {
    await client.query(`UPDATE tenant.crm_contact_account_relationships SET is_primary_contact = true, updated_by = $2 WHERE id = $1`, [relationship.id, context.userId ?? null]);
    await recordContactHistory(client, context, contact.id, "primary_contact_set", `Primary contact of ${account.display_name}`, { accountId: account.id });
  }
  await recordAccountHistory(client, context, account.id, "primary_contact_changed", contact ? `Primary contact: ${nameOf(contact)}` : "Primary contact cleared",
    { contactId: contact?.id ?? null });
  return { changed: true };
}

// Department, role and decision-maker flag of a person at this company.
export async function updateAccountContactRole(client, context, partyId, contactId, input = {}) {
  return updateContactRelationship(client, context, contactId, partyId, input);
}

// People who could be linked: those the caller can see that are not
// already active at this company.
export async function searchLinkableContacts(client, context, partyId, search = "") {
  const account = await visibleAccount(client, context, partyId);
  const values = [context.organizationId, account.id, `%${text(search).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`];
  const { rows } = await client.query(
    `SELECT contact.id, contact.display_name, contact.first_name, contact.last_name, contact.designation, other.display_name AS account_name
       FROM tenant.contacts contact
       LEFT JOIN tenant.business_parties other ON other.organization_id = contact.organization_id AND other.id = contact.party_id
      WHERE contact.organization_id = $1 AND contact.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships r WHERE r.organization_id = contact.organization_id
                         AND r.contact_id = contact.id AND r.party_id = $2 AND r.status = 'active')
        AND lower(COALESCE(contact.display_name, '') || ' ' || contact.first_name || ' ' || COALESCE(contact.last_name, '') || ' ' || COALESCE(contact.email, '')) LIKE $3
        ${contactScopeValues(context, values, "contact")}
      ORDER BY lower(contact.first_name) LIMIT 20`,
    values,
  );
  return rows.map((row) => ({ id: row.id, name: row.display_name || `${row.first_name} ${row.last_name ?? ""}`.trim(), jobTitle: row.designation, accountName: row.account_name }));
}
