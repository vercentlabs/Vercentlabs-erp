// The people at a supplier. A person is a shared Contact record (the same
// tenant.contacts CRM and Customers use, on the supplier's party); the
// supplier keeps only the relationship: the person's role here and which one
// is primary. The primary contact's name, email and phone are read from the
// contact, never copied onto the supplier.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import {
  CONTACT_NUMBER_DOCUMENT_TYPE, EMAIL_PATTERN, SUPPLIER_CONTACT_ROLES, SUPPLIER_PERMISSIONS, SupplierError, has, requireUuid, supplierContactRoleLabel, text,
} from "./constants.js";
import { loadSupplier, recordSupplierEvent, requireSupplierPermission } from "./access.js";

function fail(field, message) {
  throw new SupplierError(400, message, "SUPPLIER_CONTACT_VALIDATION", { issues: [{ field, message }] });
}

function personOf(input = {}, current = {}) {
  const pick = (field, max = 200) => (has(input, field) ? text(input[field], max) : current[field] ?? null);
  const person = {
    firstName: pick("firstName", 120), lastName: pick("lastName", 120), designation: pick("designation", 120), email: pick("email", 254)?.toLowerCase() ?? null,
    phone: pick("phone", 40), mobile: pick("mobile", 40),
  };
  if (!person.firstName) fail("firstName", "Enter the person's first name.");
  if (person.email && !EMAIL_PATTERN.test(person.email)) fail("email", "Enter a valid email address.");
  if (!person.email && !person.phone && !person.mobile) fail("email", "Enter an email, phone or mobile number so the person can be reached.");
  return person;
}

function roleOf(value) {
  const role = text(value, 40) ?? "other";
  if (!SUPPLIER_CONTACT_ROLES.some((entry) => entry.code === role)) fail("role", "Choose the contact's role.");
  return role;
}

const fullName = (person) => [person.firstName, person.lastName].filter(Boolean).join(" ");

async function makePrimary(client, context, supplierId, relationshipId) {
  await client.query(`UPDATE tenant.procurement_supplier_contacts SET is_primary = false, updated_at = now() WHERE organization_id = $1 AND supplier_id = $2 AND is_primary AND id <> $3`,
    [context.organizationId, supplierId, relationshipId]);
  await client.query(`UPDATE tenant.procurement_supplier_contacts SET is_primary = true, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, relationshipId]);
}

// input: contactId (an existing contact of this supplier's company, or one with no company) or a new person { firstName, lastName, designation,
// email, phone, mobile }; role; isPrimary. The first contact becomes the primary one.
export async function addSupplierContact(client, context, supplierId, input = {}, { record = true, skipPermission = false } = {}) {
  if (!skipPermission) requireSupplierPermission(context, SUPPLIER_PERMISSIONS.contacts, "You do not have permission to manage supplier contacts.");
  const supplier = skipPermission
    ? (await client.query(`SELECT id, party_id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplierId])).rows[0]
    : await loadSupplier(client, context, supplierId, { lock: true });
  if (!supplier) throw new SupplierError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  const role = roleOf(input.role);
  let contactId;
  let name;
  if (input.contactId) {
    const contact = (await client.query(
      `SELECT id, party_id, status, COALESCE(NULLIF(display_name, ''), concat_ws(' ', first_name, last_name)) AS name FROM tenant.contacts WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, requireUuid(input.contactId, "Contact")])).rows[0];
    if (!contact) throw new SupplierError(404, "Contact not found.", "SUPPLIER_CONTACT_NOT_FOUND");
    if (contact.status !== "active") throw new SupplierError(409, `${contact.name} is not an active contact.`, "SUPPLIER_CONTACT_INACTIVE");
    if (contact.party_id && contact.party_id !== supplier.party_id) throw new SupplierError(409, `${contact.name} works for another company.`, "SUPPLIER_CONTACT_OTHER_COMPANY");
    contactId = contact.id;
    name = contact.name;
  } else {
    const person = personOf(input);
    const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: CONTACT_NUMBER_DOCUMENT_TYPE });
    name = fullName(person);
    contactId = (await client.query(
      `INSERT INTO tenant.contacts (organization_id, party_id, contact_number, first_name, last_name, display_name, designation, email, phone, mobile, status, owner_user_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $11, $11) RETURNING id`,
      [context.organizationId, supplier.party_id, number, person.firstName, person.lastName, name, person.designation, person.email, person.phone, person.mobile, context.userId ?? null])).rows[0].id;
  }
  const existing = (await client.query(`SELECT id, status FROM tenant.procurement_supplier_contacts WHERE organization_id = $1 AND supplier_id = $2 AND contact_id = $3`,
    [context.organizationId, supplier.id, contactId])).rows[0];
  if (existing?.status === "active") throw new SupplierError(409, `${name} is already a contact of this supplier.`, "SUPPLIER_CONTACT_EXISTS");
  const hasPrimary = (await client.query(`SELECT 1 FROM tenant.procurement_supplier_contacts WHERE organization_id = $1 AND supplier_id = $2 AND is_primary`,
    [context.organizationId, supplier.id])).rows[0];
  const relationshipId = existing
    ? (await client.query(`UPDATE tenant.procurement_supplier_contacts SET status = 'active', role = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [context.organizationId, existing.id, role, context.userId ?? null])).rows[0].id
    : (await client.query(
      `INSERT INTO tenant.procurement_supplier_contacts (organization_id, supplier_id, contact_id, role, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [context.organizationId, supplier.id, contactId, role, context.userId ?? null])).rows[0].id;
  if (input.isPrimary === true || !hasPrimary) await makePrimary(client, context, supplier.id, relationshipId);
  if (record) {
    await recordSupplierEvent(client, context, supplier.id, "supplier.contact_added", `Contact added: ${name} (${supplierContactRoleLabel(role)})`, { contactId, role });
    if (input.isPrimary === true && hasPrimary) await recordSupplierEvent(client, context, supplier.id, "supplier.primary_contact_changed", `Primary contact: ${name}`, { contactId });
  }
  return { relationshipId, contactId };
}

async function loadRelationship(client, context, supplier, relationshipId) {
  const row = (await client.query(
    `SELECT link.*, contact.first_name, contact.last_name, contact.designation, contact.email, contact.phone, contact.mobile,
            COALESCE(NULLIF(contact.display_name, ''), concat_ws(' ', contact.first_name, contact.last_name)) AS name
       FROM tenant.procurement_supplier_contacts link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
      WHERE link.organization_id = $1 AND link.supplier_id = $2 AND link.id = $3 FOR UPDATE OF link`,
    [context.organizationId, supplier.id, requireUuid(relationshipId, "Contact")])).rows[0];
  if (!row) throw new SupplierError(404, "Contact not found.", "SUPPLIER_CONTACT_NOT_FOUND");
  return row;
}

// input: role, isPrimary, and the person's own details (which change the shared contact everywhere it appears).
export async function updateSupplierContact(client, context, supplierId, relationshipId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.contacts, "You do not have permission to manage supplier contacts.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = await loadRelationship(client, context, supplier, relationshipId);
  if (row.status !== "active") throw new SupplierError(409, "Add this contact again before changing it.", "SUPPLIER_CONTACT_INACTIVE");
  const role = has(input, "role") ? roleOf(input.role) : row.role;
  const personFields = ["firstName", "lastName", "designation", "email", "phone", "mobile"];
  if (personFields.some((field) => has(input, field))) {
    const person = personOf(input, { firstName: row.first_name, lastName: row.last_name, designation: row.designation, email: row.email, phone: row.phone, mobile: row.mobile });
    await client.query(
      `UPDATE tenant.contacts SET first_name = $3, last_name = $4, display_name = $5, designation = $6, email = $7, phone = $8, mobile = $9, updated_by = $10, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.contact_id, person.firstName, person.lastName, fullName(person), person.designation, person.email, person.phone, person.mobile, context.userId ?? null]);
  }
  if (role !== row.role)
    await client.query(`UPDATE tenant.procurement_supplier_contacts SET role = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, role, context.userId ?? null]);
  if (input.isPrimary === true && !row.is_primary) {
    await makePrimary(client, context, supplier.id, row.id);
    await recordSupplierEvent(client, context, supplier.id, "supplier.primary_contact_changed", `Primary contact: ${row.name}`, { contactId: row.contact_id });
  }
  return { relationshipId: row.id };
}

// Removing a contact ends the relationship only; the person stays a contact (and on documents that named them).
export async function setSupplierContactStatus(client, context, supplierId, relationshipId, active) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.contacts, "You do not have permission to manage supplier contacts.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = await loadRelationship(client, context, supplier, relationshipId);
  const status = active ? "active" : "inactive";
  if (row.status === status) return { relationshipId: row.id, changed: false };
  await client.query(`UPDATE tenant.procurement_supplier_contacts SET status = $3, is_primary = false, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, status, context.userId ?? null]);
  if (!active && row.is_primary) {
    const next = (await client.query(`SELECT id FROM tenant.procurement_supplier_contacts WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active' ORDER BY created_at LIMIT 1`,
      [context.organizationId, supplier.id])).rows[0];
    if (next) await makePrimary(client, context, supplier.id, next.id);
  }
  await recordSupplierEvent(client, context, supplier.id, active ? "supplier.contact_added" : "supplier.contact_removed", `${active ? "Contact added again" : "Contact removed"}: ${row.name}`,
    { contactId: row.contact_id });
  return { relationshipId: row.id, changed: true };
}
