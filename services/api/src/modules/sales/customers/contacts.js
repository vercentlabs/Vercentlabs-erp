// Customer contacts. People are the shared Contact records CRM, Support and
// Projects use, linked to the customer through one relationship, so a person
// is never entered twice and their email and phone live in one place.
//
// The relationship holds what is true of the person *at this customer*: role,
// job title, department, the location they work at, notes, and what they are
// used for: primary contact, billing contact, delivery contact, procurement
// contact. One person can hold several of these.
//
// When a person leaves, the relationship is made inactive. The contact itself
// stays: they may turn up at another company.
import { recordAccountHistory } from "../../crm/accounts/history.js";
import { findDuplicateContacts } from "../../crm/contacts/duplicates.js";
import { createContact } from "../../crm/contacts/records.js";
import { linkContactToAccount, setPrimaryContact, updateContactRelationship } from "../../crm/contacts/relationships.js";
import { crmContext, requireCustomerPermission } from "./access.js";
import { CUSTOMER_CONTACT_ROLES, CUSTOMER_PERMISSIONS, CustomerError } from "./constants.js";
import { loadCustomerRow } from "./records.js";
import { has, isUuid, requireUuid, text } from "./validation.js";

const NO_PERMISSION = "You do not have permission to manage customer contacts.";
const ROLE_LABELS = new Map(CUSTOMER_CONTACT_ROLES.map((entry) => [entry.code, entry.label]));
const nameOf = (row) => row.display_name || `${row.first_name} ${row.last_name ?? ""}`.trim();
const like = (value) => `%${text(value).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;

function toContact(row) {
  return {
    id: row.contact_id,
    relationshipId: row.id,
    contactNumber: row.contact_number,
    name: nameOf(row),
    firstName: row.first_name,
    lastName: row.last_name,
    jobTitle: row.job_title,
    department: row.department,
    role: row.role,
    roleLabel: row.role ? ROLE_LABELS.get(row.role) ?? row.role : null,
    // Communication details come from the shared contact, never a copy.
    email: row.email,
    phone: row.mobile || row.phone,
    addressId: row.address_id,
    addressLabel: row.address_id ? row.address_label || row.address_city || null : null,
    notes: row.notes,
    isPrimary: row.is_primary_contact,
    isBillingContact: row.is_billing_contact,
    isShippingContact: row.is_shipping_contact,
    isProcurementContact: row.is_procurement_contact,
    isActive: row.status === "active" && row.contact_status === "active",
    relationshipActive: row.status === "active",
  };
}

const CONTACT_SELECT = `
  SELECT link.*, contact.contact_number, contact.display_name, contact.first_name, contact.last_name, contact.email, contact.mobile, contact.phone, contact.status AS contact_status,
         address.label AS address_label, address.city AS address_city
    FROM tenant.crm_contact_account_relationships link
    JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
    LEFT JOIN tenant.addresses address ON address.organization_id = link.organization_id AND address.id = link.address_id`;

// filters: includeInactive (default true), search (name, email, phone, role,
// department), addressId.
export async function listCustomerContacts(client, context, customerId, { includeInactive = true, search = "", addressId = null } = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.viewContacts, "You do not have permission to view customer contacts.");
  const customer = await loadCustomerRow(client, context, customerId);
  const roleCodes = CUSTOMER_CONTACT_ROLES.filter((entry) => text(search) && entry.label.toLowerCase().includes(text(search).toLowerCase())).map((entry) => entry.code);
  const { rows } = await client.query(
    `${CONTACT_SELECT} WHERE link.organization_id = $1 AND link.party_id = $2 AND ($3 OR (link.status = 'active' AND contact.status = 'active')) AND contact.status <> 'archived'
        AND ($5::uuid IS NULL OR link.address_id = $5)
        AND (lower(concat_ws(' ', contact.display_name, contact.first_name, contact.last_name, contact.email, contact.mobile, contact.phone, link.job_title, link.department, link.role)) LIKE $4
             OR link.role = ANY ($6::text[]))
      ORDER BY link.status = 'active' DESC, link.is_primary_contact DESC, lower(contact.first_name), lower(COALESCE(contact.last_name, ''))`,
    [context.organizationId, customer.id, includeInactive, like(search), isUuid(addressId) ? addressId : null, roleCodes],
  );
  return rows.map(toContact);
}

async function lockLink(client, context, partyId, contactId) {
  const { rows } = await client.query(`${CONTACT_SELECT} WHERE link.organization_id = $1 AND link.party_id = $2 AND link.contact_id = $3 FOR UPDATE OF link`,
    [context.organizationId, partyId, requireUuid(contactId, "Contact")]);
  if (!rows[0]) throw new CustomerError(404, "This contact is not linked to this customer.", "SALES_CUSTOMER_CONTACT_NOT_LINKED");
  return rows[0];
}

const reload = async (client, context, partyId, contactId) => toContact(await lockLink(client, context, partyId, contactId));

function relationshipInput(input) {
  const fields = {};
  for (const field of ["jobTitle", "department", "role"]) if (has(input, field)) fields[field] = text(input[field]);
  if (fields.role && !ROLE_LABELS.has(fields.role)) throw new CustomerError(400, "Choose a contact role.", "SALES_CUSTOMER_CONTACT_VALIDATION", { issues: [{ field: "role", message: "Choose a contact role." }] });
  return fields;
}

// The location, the notes and the procurement flag: what CRM does not hold.
async function applyDetails(client, context, customer, link, input) {
  const sets = [];
  const values = [link.id];
  const changes = {};
  if (has(input, "addressId")) {
    const addressId = text(input.addressId) || null;
    if (addressId) {
      const { rows } = await client.query(`SELECT status FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND id = $3`,
        [context.organizationId, customer.id, requireUuid(addressId, "Address")]);
      if (!rows[0]) throw new CustomerError(400, "Choose one of this customer's addresses.", "SALES_CUSTOMER_CONTACT_VALIDATION", { issues: [{ field: "addressId", message: "Choose one of this customer's addresses." }] });
      if (rows[0].status !== "active" && addressId !== link.address_id) throw new CustomerError(409, "That address is inactive.", "SALES_CUSTOMER_ADDRESS_INACTIVE");
    }
    if (addressId !== link.address_id) { values.push(addressId); sets.push(`address_id = $${values.length}`); changes.address = true; }
  }
  if (has(input, "notes") && (text(input.notes).slice(0, 2000) || null) !== link.notes) { values.push(text(input.notes).slice(0, 2000) || null); sets.push(`notes = $${values.length}`); }
  if (has(input, "isProcurementContact") && Boolean(input.isProcurementContact) !== link.is_procurement_contact) {
    if (input.isProcurementContact && link.status !== "active") throw new CustomerError(409, "An inactive contact cannot hold this role.", "SALES_CUSTOMER_CONTACT_INACTIVE");
    values.push(Boolean(input.isProcurementContact));
    sets.push(`is_procurement_contact = $${values.length}`);
    changes.procurement = Boolean(input.isProcurementContact);
  }
  if (!sets.length) return;
  values.push(context.userId ?? null);
  await client.query(`UPDATE tenant.crm_contact_account_relationships SET ${sets.join(", ")}, updated_by = $${values.length} WHERE id = $1`, values);
  if (has(changes, "procurement"))
    await recordAccountHistory(client, context, customer.id, "updated", `${nameOf(link)} ${changes.procurement ? "is now" : "is no longer"} a procurement contact`, { contactId: link.contact_id, kind: "contact_role_changed" });
}

// Moves the billing / delivery flag to this contact, or clears it; and makes
// the contact primary.
async function applyFlags(client, context, customer, link, input) {
  for (const [flag, column, label] of [["isBillingContact", "is_billing_contact", "Billing"], ["isShippingContact", "is_shipping_contact", "Delivery"]]) {
    if (!has(input, flag) || Boolean(input[flag]) === link[column]) continue;
    if (input[flag]) {
      if (link.status !== "active" || link.contact_status !== "active") throw new CustomerError(409, "An inactive contact cannot hold this role.", "SALES_CUSTOMER_CONTACT_INACTIVE");
      await client.query(`UPDATE tenant.crm_contact_account_relationships SET ${column} = false WHERE organization_id = $1 AND party_id = $2 AND ${column}`, [context.organizationId, customer.id]);
    }
    await client.query(`UPDATE tenant.crm_contact_account_relationships SET ${column} = $2, updated_by = $3 WHERE id = $1`, [link.id, Boolean(input[flag]), context.userId ?? null]);
    await recordAccountHistory(client, context, customer.id, "primary_contact_changed", input[flag] ? `${label} contact: ${nameOf(link)}` : `${label} contact cleared`,
      { contactId: link.contact_id, kind: flag });
  }
  if (input.isPrimary === true && !link.is_primary_contact) {
    requireCustomerPermission(context, CUSTOMER_PERMISSIONS.setPrimaryContact, "You do not have permission to change the primary contact.");
    if (link.status !== "active" || link.contact_status !== "active") throw new CustomerError(409, "An inactive contact cannot be the primary contact.", "SALES_CUSTOMER_CONTACT_INACTIVE");
    await setPrimaryContact(client, crmContext(context), customer.id, link.contact_id);
  }
}

// Existing contacts that look like the person being added: the same email,
// mobile or phone, or a similar name already at this customer. The caller
// links one of them instead of creating a copy.
// input: { firstName, lastName, email, phone }
export async function findExistingContact(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.manageContacts, NO_PERMISSION);
  const customer = await loadCustomerRow(client, context, customerId);
  const probe = { firstName: input.firstName, lastName: input.lastName, email: input.email, mobile: input.phone, phone: input.phone, accountId: customer.id };
  const found = await findDuplicateContacts(client, crmContext(context), probe, { limit: 5 });
  const matches = found.matches.filter((match) => match.strength === "exact" || match.signals.includes("name_company"));
  if (!matches.length) return { matches: [] };
  const linked = await client.query(
    `SELECT contact_id, status FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND party_id = $2 AND contact_id = ANY ($3::uuid[])`,
    [context.organizationId, customer.id, matches.map((match) => match.id)],
  );
  const statusOf = new Map(linked.rows.map((row) => [row.contact_id, row.status]));
  return {
    matches: matches.map((match) => ({
      id: match.id, name: match.name, email: match.email ?? null, phone: match.mobile ?? null, jobTitle: match.jobTitle ?? null, accountName: match.accountName ?? null,
      reasons: match.reasons.map((reason) => reason.label),
      // "linked": already an active contact of this customer; "inactive": was one, can be restored.
      link: statusOf.get(match.id) === "active" ? "linked" : statusOf.has(match.id) ? "inactive" : "none",
    })),
  };
}

// A new person at this customer. input: firstName, lastName, email, phone,
// jobTitle, department, role, addressId, notes, isPrimary, isBillingContact,
// isShippingContact, isProcurementContact, and allowDuplicate to create the
// person although a contact like them exists.
export async function addCustomerContact(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.manageContacts, NO_PERMISSION);
  const customer = await loadCustomerRow(client, context, customerId, { lock: true });
  if (!text(input.firstName)) throw new CustomerError(400, "Enter the contact's first name.", "SALES_CUSTOMER_CONTACT_VALIDATION", { issues: [{ field: "firstName", message: "Enter the first name." }] });
  const fields = relationshipInput(input);
  if (input.allowDuplicate !== true) {
    const existing = await findExistingContact(client, context, customer.id, input);
    if (existing.matches.length)
      throw new CustomerError(409, "An existing contact was found. Link it instead of creating a copy.", "SALES_CUSTOMER_CONTACT_DUPLICATE", { existingContactFound: true, matches: existing.matches });
  }
  const created = await createContact(client, crmContext(context, { overrideDuplicate: true }), {
    firstName: input.firstName, lastName: input.lastName, email: input.email, mobile: input.phone, accountId: customer.id, ...fields,
  }, { origin: "account", allowDuplicate: true, duplicateReason: text(input.duplicateReason) || `Added as a separate contact of ${customer.display_name}` });
  const first = (await client.query(`SELECT count(*)::int AS n FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND party_id = $2 AND status = 'active'`,
    [context.organizationId, customer.id])).rows[0].n === 1;
  const link = await lockLink(client, context, customer.id, created.id);
  await applyDetails(client, context, customer, link, input);
  // The first contact of a customer is its primary, billing and delivery contact.
  const flagContext = first ? { ...context, permissions: [...(context.permissions ?? []), CUSTOMER_PERMISSIONS.setPrimaryContact] } : context;
  await applyFlags(client, flagContext, customer, link, first ? { isPrimary: true, isBillingContact: true, isShippingContact: true, ...input } : input);
  return reload(client, context, customer.id, created.id);
}

// Links an existing contact, or restores a relationship that had ended.
// input: contactId plus the relationship fields and flags.
export async function linkCustomerContact(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.manageContacts, NO_PERMISSION);
  const customer = await loadCustomerRow(client, context, customerId, { lock: true });
  const contactId = requireUuid(input.contactId, "Contact");
  await linkContactToAccount(client, crmContext(context), contactId, { accountId: customer.id, ...relationshipInput(input) });
  const link = await lockLink(client, context, customer.id, contactId);
  await applyDetails(client, context, customer, link, input);
  await applyFlags(client, context, customer, link, input);
  return reload(client, context, customer.id, contactId);
}

// Open documents addressed to this person at this customer.
async function openDocumentsFor(client, context, partyId, contactId) {
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM tenant.sales_quotations WHERE organization_id = $1 AND party_id = $2 AND contact_id = $3 AND lifecycle_status IN ('draft', 'pending_approval', 'approved', 'sent', 'viewed'))::int AS quotations,
            (SELECT count(*) FROM tenant.sales_orders WHERE organization_id = $1 AND party_id = $2 AND contact_id = $3 AND lifecycle_status IN ('draft', 'pending_approval', 'approved', 'confirmed', 'on_hold'))::int AS orders`,
    [context.organizationId, partyId, contactId],
  );
  return rows[0];
}

// input: jobTitle, department, role, addressId, notes, isPrimary,
// isBillingContact, isShippingContact, isProcurementContact, isActive, and
// confirmOpenDocuments to end a relationship that open documents refer to.
export async function updateCustomerContact(client, context, customerId, contactId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.manageContacts, NO_PERMISSION);
  const customer = await loadCustomerRow(client, context, customerId, { lock: true });
  const link = await lockLink(client, context, customer.id, contactId);
  const fields = relationshipInput(input);
  const changed = Object.entries({ jobTitle: "job_title", department: "department", role: "role" }).filter(([field, column]) => has(fields, field) && (fields[field] || null) !== (link[column] ?? null));
  if (has(input, "isActive") && Boolean(input.isActive) !== (link.status === "active")) {
    requireCustomerPermission(context, CUSTOMER_PERMISSIONS.inactivateContact, "You do not have permission to deactivate customer contacts.");
    fields.status = input.isActive ? "active" : "inactive";
    if (!input.isActive && input.confirmOpenDocuments !== true) {
      const open = await openDocumentsFor(client, context, customer.id, link.contact_id);
      if (open.quotations || open.orders)
        throw new CustomerError(409,
          `${nameOf(link)} is the contact on ${[open.quotations ? `${open.quotations} open quotation${open.quotations === 1 ? "" : "s"}` : null, open.orders ? `${open.orders} open sales order${open.orders === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ")}. Those documents keep the contact details they were created with.`,
          "SALES_CUSTOMER_CONTACT_IN_USE", { requiresConfirmation: true, openQuotations: open.quotations, openOrders: open.orders });
    }
  }
  if (Object.keys(fields).length) await updateContactRelationship(client, crmContext(context), link.contact_id, customer.id, fields);
  if (fields.status === "active") await recordAccountHistory(client, context, customer.id, "contact_linked", `Contact ${nameOf(link)} reactivated`, { contactId: link.contact_id, kind: "contact_reactivated" });
  if (changed.length && !fields.status)
    await recordAccountHistory(client, context, customer.id, "updated", `Contact role changed: ${nameOf(link)}`, {
      contactId: link.contact_id, kind: "contact_role_changed",
      ...Object.fromEntries(changed.map(([field, column]) => [field, {
        label: { jobTitle: "Job title", department: "Department", role: "Role" }[field],
        from: field === "role" ? ROLE_LABELS.get(link.role) ?? link.role ?? null : link[column] ?? null,
        to: field === "role" ? ROLE_LABELS.get(fields.role) ?? (fields.role || null) : fields[field] || null,
      }])),
    });
  const current = await lockLink(client, context, customer.id, link.contact_id);
  await applyDetails(client, context, customer, current, input);
  await applyFlags(client, context, customer, current, input);
  return reload(client, context, customer.id, link.contact_id);
}

export const setPrimaryCustomerContact = (client, context, customerId, contactId) => updateCustomerContact(client, context, customerId, contactId, { isPrimary: true });
export const setBillingCustomerContact = (client, context, customerId, contactId) => updateCustomerContact(client, context, customerId, contactId, { isBillingContact: true });
export const setShippingCustomerContact = (client, context, customerId, contactId) => updateCustomerContact(client, context, customerId, contactId, { isShippingContact: true });
export const deactivateCustomerContact = (client, context, customerId, contactId, options = {}) =>
  updateCustomerContact(client, context, customerId, contactId, { isActive: false, confirmOpenDocuments: options.confirmOpenDocuments === true });

// Contacts that could be linked: active people not already at this customer.
// Searches name, email and phone.
export async function searchLinkableCustomerContacts(client, context, customerId, search = "") {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.manageContacts, NO_PERMISSION);
  const customer = await loadCustomerRow(client, context, customerId);
  const { rows } = await client.query(
    `SELECT contact.id, contact.display_name, contact.first_name, contact.last_name, contact.email, contact.designation, other.display_name AS account_name
       FROM tenant.contacts contact
       LEFT JOIN tenant.business_parties other ON other.organization_id = contact.organization_id AND other.id = contact.party_id
      WHERE contact.organization_id = $1 AND contact.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships link WHERE link.organization_id = contact.organization_id
                         AND link.contact_id = contact.id AND link.party_id = $2 AND link.status = 'active')
        AND lower(concat_ws(' ', contact.display_name, contact.first_name, contact.last_name, contact.email, contact.mobile, contact.phone)) LIKE $3
      ORDER BY lower(contact.first_name) LIMIT 20`,
    [context.organizationId, customer.id, like(search)],
  );
  return rows.map((row) => ({ id: row.id, name: nameOf(row), email: row.email, jobTitle: row.designation, accountName: row.account_name }));
}
