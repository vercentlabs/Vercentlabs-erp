// The people at a supplier. A person is a shared Contact record (the same
// tenant.contacts CRM and Customers use), so one person is never copied per
// role or per module: the supplier relationship carries the person's roles
// here (several at once), optionally the location they work at, and whether
// they are still active for this supplier. The default person for each
// purpose (primary, RFQ, ordering, accounts, dispatch) is one of these
// relationships. Documents keep the person they named and a snapshot, so a
// changed email or a person who leaves never changes an old document.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import {
  CONTACT_NUMBER_DOCUMENT_TYPE, EMAIL_PATTERN, SUPPLIER_CONTACT_PURPOSES, SUPPLIER_CONTACT_ROLES, SUPPLIER_PERMISSIONS, SupplierError, has, isUuid, requireUuid,
  supplierContactPurposeLabel, supplierContactRoleLabel, text,
} from "./constants.js";
import { loadSupplier, recordSupplierEvent, requireSupplierPermission, supplierCan } from "./access.js";
import { CONTACT_DEFAULT_COLUMNS, assignDefault, clearDefaultsFor, readDefaults } from "./default-assignments.js";

const ROLE_ORDER = SUPPLIER_CONTACT_ROLES.map((entry) => entry.code);

function fail(field, message, code = "SUPPLIER_CONTACT_VALIDATION") {
  throw new SupplierError(400, message, code, { issues: [{ field, message }] });
}

export const CONTACT_SELECT = `
  SELECT link.id, link.supplier_id, link.contact_id, link.supplier_address_id, link.status, link.created_at,
         COALESCE((SELECT array_agg(role.role) FROM tenant.procurement_supplier_contact_roles role
                    WHERE role.organization_id = link.organization_id AND role.supplier_contact_id = link.id), '{}') AS roles,
         contact.contact_number, contact.first_name, contact.last_name, contact.designation, contact.department, contact.email, contact.phone, contact.mobile,
         contact.party_id AS contact_party_id, contact.status AS contact_status,
         COALESCE(NULLIF(contact.display_name, ''), concat_ws(' ', contact.first_name, contact.last_name)) AS name,
         location.label AS location_label, location.city AS location_city, location.status AS location_status
    FROM tenant.procurement_supplier_contacts link
    JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
    LEFT JOIN tenant.procurement_supplier_addresses location ON location.organization_id = link.organization_id AND location.id = link.supplier_address_id`;

export function toContact(row, defaults = {}) {
  const roles = [...row.roles].sort((left, right) => ROLE_ORDER.indexOf(left) - ROLE_ORDER.indexOf(right));
  return {
    id: row.id, contactId: row.contact_id, contactNumber: row.contact_number, name: row.name, firstName: row.first_name, lastName: row.last_name,
    designation: row.designation, department: row.department, email: row.email, phone: row.phone, mobile: row.mobile,
    roles, roleLabels: roles.map(supplierContactRoleLabel),
    defaultFor: Object.entries(CONTACT_DEFAULT_COLUMNS).filter(([, column]) => defaults[column] === row.id).map(([purpose]) => purpose),
    location: row.supplier_address_id ? { id: row.supplier_address_id, label: row.location_label, city: row.location_city, status: row.location_status } : null,
    status: row.status,
  };
}

function personOf(input = {}, current = {}) {
  const pick = (field, max = 200) => (has(input, field) ? text(input[field], max) : current[field] ?? null);
  const person = {
    firstName: pick("firstName", 120), lastName: pick("lastName", 120), designation: pick("designation", 120), department: pick("department", 120),
    email: pick("email", 254), phone: pick("phone", 40), mobile: pick("mobile", 40),
  };
  if (!person.firstName) fail("firstName", "Enter the person's first name.");
  if (person.email && !EMAIL_PATTERN.test(person.email)) fail("email", "Enter a valid email address.");
  for (const field of ["phone", "mobile"])
    if (person[field] && person[field].replace(/[^0-9]/g, "").length < 6) fail(field, "Enter a valid number.");
  // An email is needed only to email them (an RFQ or a purchase order); a mobile or phone is enough to keep them on file.
  if (!person.email && !person.phone && !person.mobile) fail("mobile", "Enter an email, mobile or phone number so the person can be reached.");
  return person;
}

function rolesOf(value) {
  const roles = [...new Set((Array.isArray(value) ? value : []).map(String))];
  if (!roles.length) fail("roles", "Choose what the person does for you at this supplier.");
  const unknown = roles.find((role) => !ROLE_ORDER.includes(role));
  if (unknown) fail("roles", `"${unknown}" is not a contact role.`);
  return roles.sort((left, right) => ROLE_ORDER.indexOf(left) - ROLE_ORDER.indexOf(right));
}

async function locationOf(client, context, supplierId, value, current = null) {
  if (!value) return null;
  const row = (await client.query(`SELECT id, status FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND id = $3`,
    [context.organizationId, supplierId, requireUuid(value, "Location")])).rows[0];
  if (!row) fail("locationId", "Choose one of this supplier's locations.");
  if (row.status !== "active" && row.id !== current) fail("locationId", "That location is inactive.");
  return row.id;
}

const fullName = (person) => [person.firstName, person.lastName].filter(Boolean).join(" ");
const normEmail = (value) => (value ? String(value).trim().toLowerCase() : null);
const normPhone = (value) => (value ? String(value).replace(/[^0-9]/g, "").slice(-10) || null : null);

// Likely the same person: within this supplier (same email, mobile, or name and designation), and anywhere in the tenant (same email or mobile),
// so an existing person is linked instead of copied.
export async function checkSupplierContactDuplicates(client, context, supplierId, input = {}, exceptRelationshipId = null) {
  const email = normEmail(input.email);
  const mobile = normPhone(input.mobile) ?? normPhone(input.phone);
  const name = [text(input.firstName), text(input.lastName)].filter(Boolean).join(" ").toLowerCase() || null;
  const designation = text(input.designation)?.toLowerCase() ?? null;
  if (!email && !mobile && !name) return [];
  const inSupplier = (await client.query(
    `SELECT link.id, link.contact_id, link.status, contact.designation, COALESCE(NULLIF(contact.display_name, ''), concat_ws(' ', contact.first_name, contact.last_name)) AS name,
            ($3::text IS NOT NULL AND contact.normalized_email = $3) AS same_email,
            ($4::text IS NOT NULL AND (contact.normalized_mobile = $4 OR right(regexp_replace(COALESCE(contact.phone, ''), '[^0-9]', '', 'g'), 10) = $4)) AS same_mobile,
            ($5::text IS NOT NULL AND $6::text IS NOT NULL AND lower(concat_ws(' ', contact.first_name, contact.last_name)) = $5 AND lower(contact.designation) = $6) AS same_name
       FROM tenant.procurement_supplier_contacts link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
      WHERE link.organization_id = $1 AND link.supplier_id = $2 AND ($7::uuid IS NULL OR link.id <> $7::uuid)`,
    [context.organizationId, supplierId, email, mobile, name, designation, exceptRelationshipId])).rows
    .filter((row) => row.same_email || row.same_mobile || row.same_name)
    .map((row) => ({ scope: "supplier", relationshipId: row.id, contactId: row.contact_id, name: row.name, designation: row.designation, status: row.status,
      reason: row.same_email ? "Same email" : row.same_mobile ? "Same mobile" : "Same name and designation" }));
  const linked = new Set(inSupplier.map((match) => match.contactId));
  const elsewhere = (email || mobile) ? (await client.query(
    `SELECT contact.id, contact.designation, COALESCE(NULLIF(contact.display_name, ''), concat_ws(' ', contact.first_name, contact.last_name)) AS name, party.display_name AS company,
            ($2::text IS NOT NULL AND contact.normalized_email = $2) AS same_email
       FROM tenant.contacts contact LEFT JOIN tenant.business_parties party ON party.organization_id = contact.organization_id AND party.id = contact.party_id
      WHERE contact.organization_id = $1 AND contact.status = 'active'
        AND (($2::text IS NOT NULL AND contact.normalized_email = $2) OR ($3::text IS NOT NULL AND contact.normalized_mobile = $3))
        AND NOT EXISTS (SELECT 1 FROM tenant.procurement_supplier_contacts link WHERE link.organization_id = contact.organization_id AND link.supplier_id = $4 AND link.contact_id = contact.id)
      LIMIT 5`, [context.organizationId, email, mobile, supplierId])).rows : [];
  return [...inSupplier, ...elsewhere.filter((row) => !linked.has(row.id)).map((row) => ({
    scope: "tenant", contactId: row.id, name: row.name, designation: row.designation, company: row.company, reason: row.same_email ? "Same email" : "Same mobile",
  }))];
}

async function writeRoles(client, context, supplierId, relationshipId, roles) {
  await client.query(`DELETE FROM tenant.procurement_supplier_contact_roles WHERE organization_id = $1 AND supplier_contact_id = $2 AND NOT (role = ANY($3::text[]))`,
    [context.organizationId, relationshipId, roles]);
  await client.query(
    `INSERT INTO tenant.procurement_supplier_contact_roles (organization_id, supplier_id, supplier_contact_id, role) SELECT $1, $2, $3, unnest($4::text[]) ON CONFLICT DO NOTHING`,
    [context.organizationId, supplierId, relationshipId, roles]);
  // The old one-role column keeps a value only because its NOT NULL check cannot be removed.
  await client.query(`UPDATE tenant.procurement_supplier_contacts SET role = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, relationshipId, roles[0]]);
}

async function applyDefaults(client, context, supplierId, relationshipId, name, requested, { record = true } = {}) {
  for (const purpose of [...new Set(requested)]) {
    if (!CONTACT_DEFAULT_COLUMNS[purpose]) fail("defaults", `"${purpose}" is not a contact purpose.`);
    await assignDefault(client, context, supplierId, "contact", purpose, { id: relationshipId, name }, { record });
  }
}

// input: contactId (an existing contact anywhere in the tenant: linked, not copied) or a new person { firstName, lastName, designation, department,
// email, phone, mobile }; roles; locationId; defaults (contact purposes). The first person becomes the primary contact.
// Returns { relationshipId, contactId, warnings }.
export async function addSupplierContact(client, context, supplierId, input = {}, { record = true, skipPermission = false } = {}) {
  if (!skipPermission) {
    requireSupplierPermission(context, SUPPLIER_PERMISSIONS.contacts, "You do not have permission to manage supplier contacts.");
    if (Array.isArray(input.defaults) && input.defaults.length) requireSupplierPermission(context, SUPPLIER_PERMISSIONS.defaults, "You do not have permission to set supplier defaults.");
  }
  const supplier = skipPermission
    ? (await client.query(`SELECT id, party_id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplierId])).rows[0]
    : await loadSupplier(client, context, supplierId, { lock: true });
  if (!supplier) throw new SupplierError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  const roles = rolesOf(input.roles ?? (input.role ? [input.role === "quotation" ? "sales" : input.role] : null));
  const locationId = await locationOf(client, context, supplier.id, input.locationId);
  let contactId;
  let name;
  let warnings = [];
  if (input.contactId) {
    const contact = (await client.query(
      `SELECT id, status, COALESCE(NULLIF(display_name, ''), concat_ws(' ', first_name, last_name)) AS name FROM tenant.contacts WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, requireUuid(input.contactId, "Contact")])).rows[0];
    if (!contact) throw new SupplierError(404, "Contact not found.", "SUPPLIER_CONTACT_NOT_FOUND");
    if (contact.status !== "active") throw new SupplierError(409, `${contact.name} is not an active contact.`, "SUPPLIER_CONTACT_INACTIVE");
    contactId = contact.id;
    name = contact.name;
  } else {
    const person = personOf(input);
    warnings = await checkSupplierContactDuplicates(client, context, supplier.id, person);
    const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: CONTACT_NUMBER_DOCUMENT_TYPE });
    name = fullName(person);
    contactId = (await client.query(
      `INSERT INTO tenant.contacts (organization_id, party_id, contact_number, first_name, last_name, display_name, designation, department, email, phone, mobile, status,
         owner_user_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12, $12, $12) RETURNING id`,
      [context.organizationId, supplier.party_id, number, person.firstName, person.lastName, name, person.designation, person.department, person.email, person.phone, person.mobile,
        context.userId ?? null])).rows[0].id;
  }
  const existing = (await client.query(`SELECT id, status FROM tenant.procurement_supplier_contacts WHERE organization_id = $1 AND supplier_id = $2 AND contact_id = $3`,
    [context.organizationId, supplier.id, contactId])).rows[0];
  if (existing?.status === "active") throw new SupplierError(409, `${name} is already a contact of this supplier.`, "SUPPLIER_CONTACT_EXISTS", { relationshipId: existing.id });
  const relationshipId = existing
    ? (await client.query(
      `UPDATE tenant.procurement_supplier_contacts SET status = 'active', supplier_address_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [context.organizationId, existing.id, locationId, context.userId ?? null])).rows[0].id
    : (await client.query(
      `INSERT INTO tenant.procurement_supplier_contacts (organization_id, supplier_id, contact_id, role, supplier_address_id, is_primary, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, false, $6, $6) RETURNING id`,
      [context.organizationId, supplier.id, contactId, roles[0], locationId, context.userId ?? null])).rows[0].id;
  await writeRoles(client, context, supplier.id, relationshipId, roles);
  const defaults = await readDefaults(client, context.organizationId, supplier.id);
  const requested = Array.isArray(input.defaults) ? input.defaults : input.isPrimary === true ? ["primary"] : [];
  if (!defaults.primary_contact_id && !requested.includes("primary")) requested.push("primary");
  await applyDefaults(client, context, supplier.id, relationshipId, name, requested, { record });
  if (record)
    await recordSupplierEvent(client, context, supplier.id, "supplier.contact_added", `Contact added: ${name} (${roles.map(supplierContactRoleLabel).join(", ")})`,
      { contactId, relationshipId, roles, linkedExisting: Boolean(input.contactId) });
  return { relationshipId, contactId, warnings };
}

async function loadRelationship(client, context, supplier, relationshipId) {
  const row = (await client.query(`${CONTACT_SELECT} WHERE link.organization_id = $1 AND link.supplier_id = $2 AND link.id = $3 FOR UPDATE OF link`,
    [context.organizationId, supplier.id, requireUuid(relationshipId, "Contact")])).rows[0];
  if (!row) throw new SupplierError(404, "Contact not found.", "SUPPLIER_CONTACT_NOT_FOUND");
  return row;
}

// input: roles, locationId, defaults (the full list of purposes this person is the default for), and the person's own details (a shared contact:
// the change shows wherever the person appears; documents keep their snapshot). Returns { relationshipId, warnings }.
export async function updateSupplierContact(client, context, supplierId, relationshipId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.contacts, "You do not have permission to manage supplier contacts.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = await loadRelationship(client, context, supplier, relationshipId);
  if (row.status !== "active") throw new SupplierError(409, "Reactivate this contact before changing it.", "SUPPLIER_CONTACT_INACTIVE");
  let warnings = [];
  const personFields = ["firstName", "lastName", "designation", "department", "email", "phone", "mobile"];
  if (personFields.some((field) => has(input, field))) {
    const before = { firstName: row.first_name, lastName: row.last_name, designation: row.designation, department: row.department, email: row.email, phone: row.phone, mobile: row.mobile };
    const person = personOf(input, before);
    warnings = await checkSupplierContactDuplicates(client, context, supplier.id, person, row.id);
    await client.query(
      `UPDATE tenant.contacts SET first_name = $3, last_name = $4, display_name = $5, designation = $6, department = $7, email = $8, phone = $9, mobile = $10, updated_by = $11, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.contact_id, person.firstName, person.lastName, fullName(person), person.designation, person.department, person.email, person.phone, person.mobile,
        context.userId ?? null]);
    if (normEmail(person.email) !== normEmail(before.email))
      await recordSupplierEvent(client, context, supplier.id, "supplier.contact_email_changed", `Email of ${fullName(person)}: ${before.email ?? "none"} → ${person.email ?? "none"}`,
        { contactId: row.contact_id });
    const rest = personFields.filter((field) => field !== "email" && (person[field] ?? null) !== (before[field] ?? null));
    if (rest.length)
      await recordSupplierEvent(client, context, supplier.id, "supplier.contact_changed", `Contact changed: ${fullName(person)} (${rest.join(", ")})`, { contactId: row.contact_id, changed: rest });
  }
  if (has(input, "roles")) {
    const roles = rolesOf(input.roles);
    const before = [...row.roles].sort((left, right) => ROLE_ORDER.indexOf(left) - ROLE_ORDER.indexOf(right));
    if (roles.join() !== before.join()) {
      await writeRoles(client, context, supplier.id, row.id, roles);
      await recordSupplierEvent(client, context, supplier.id, "supplier.contact_role_changed",
        `Roles of ${row.name}: ${before.map(supplierContactRoleLabel).join(", ") || "none"} → ${roles.map(supplierContactRoleLabel).join(", ")}`, { contactId: row.contact_id, from: before, to: roles });
    }
  }
  if (has(input, "locationId")) {
    const locationId = await locationOf(client, context, supplier.id, input.locationId, row.supplier_address_id);
    if (locationId !== row.supplier_address_id)
      await client.query(`UPDATE tenant.procurement_supplier_contacts SET supplier_address_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, row.id, locationId, context.userId ?? null]);
  }
  if (Array.isArray(input.defaults)) {
    const defaults = await readDefaults(client, context.organizationId, supplier.id);
    const now = Object.entries(CONTACT_DEFAULT_COLUMNS).filter(([, column]) => defaults[column] === row.id).map(([purpose]) => purpose);
    const add = input.defaults.filter((purpose) => !now.includes(purpose));
    const remove = now.filter((purpose) => !input.defaults.includes(purpose));
    if (add.length || remove.length) requireSupplierPermission(context, SUPPLIER_PERMISSIONS.defaults, "You do not have permission to set supplier defaults.");
    await applyDefaults(client, context, supplier.id, row.id, row.name, add);
    for (const purpose of remove) await assignDefault(client, context, supplier.id, "contact", purpose, null);
  } else if (input.isPrimary === true) {
    await applyDefaults(client, context, supplier.id, row.id, row.name, ["primary"]);
  }
  return { relationshipId: row.id, warnings };
}

// Someone who left: inactive for this supplier, no longer anyone's default, never deleted (old documents still name them).
export async function setSupplierContactStatus(client, context, supplierId, relationshipId, active) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.contactsDeactivate, "You do not have permission to deactivate supplier contacts.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = await loadRelationship(client, context, supplier, relationshipId);
  const status = active ? "active" : "inactive";
  if (row.status === status) return { relationshipId: row.id, changed: false, clearedDefaults: [] };
  await client.query(`UPDATE tenant.procurement_supplier_contacts SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, status, context.userId ?? null]);
  const clearedDefaults = active ? [] : await clearDefaultsFor(client, context, supplier.id, "contact", row.id);
  await recordSupplierEvent(client, context, supplier.id, active ? "supplier.contact_reactivated" : "supplier.contact_deactivated",
    `${active ? "Contact reactivated" : "Contact deactivated"}: ${row.name}${clearedDefaults.length ? ` (no longer the ${clearedDefaults.map(supplierContactPurposeLabel).join(", ").toLowerCase()})` : ""}`,
    { contactId: row.contact_id, clearedDefaults });
  return { relationshipId: row.id, changed: true, clearedDefaults };
}

// purpose: primary | rfq | ordering | accounts | dispatch; relationshipId: an active contact of this supplier, or null to clear.
export async function setSupplierContactForPurpose(client, context, supplierId, purpose, relationshipId) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.defaults, "You do not have permission to set supplier defaults.");
  if (!SUPPLIER_CONTACT_PURPOSES.some((entry) => entry.code === purpose)) fail("purpose", "Choose the purpose.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  if (!relationshipId) return { changed: await assignDefault(client, context, supplier.id, "contact", purpose, null) };
  const row = await loadRelationship(client, context, supplier, relationshipId);
  if (row.status !== "active") throw new SupplierError(409, "An inactive contact cannot be a default.", "SUPPLIER_CONTACT_INACTIVE");
  return { changed: await assignDefault(client, context, supplier.id, "contact", purpose, { id: row.id, name: row.name }) };
}

export const setPrimarySupplierContact = (client, context, supplierId, relationshipId) => setSupplierContactForPurpose(client, context, supplierId, "primary", relationshipId);

// filters: search (name, email, phone, designation), role, locationId, status.
export async function listSupplierContacts(client, context, supplierId, filters = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.contactsView, "You do not have permission to view supplier contacts.");
  const supplier = await loadSupplier(client, context, supplierId);
  const values = [context.organizationId, supplier.id];
  const bind = (value) => `$${values.push(value)}`;
  let where = "link.organization_id = $1 AND link.supplier_id = $2";
  if (ROLE_ORDER.includes(filters.role))
    where += ` AND EXISTS (SELECT 1 FROM tenant.procurement_supplier_contact_roles r WHERE r.organization_id = link.organization_id AND r.supplier_contact_id = link.id AND r.role = ${bind(filters.role)})`;
  if (isUuid(filters.locationId)) where += ` AND link.supplier_address_id = ${bind(filters.locationId)}`;
  if (filters.status === "active" || filters.status === "inactive") where += ` AND link.status = ${bind(filters.status)}`;
  if (text(filters.search)) {
    const term = bind(`%${text(filters.search).replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (contact.display_name ILIKE ${term} OR concat_ws(' ', contact.first_name, contact.last_name) ILIKE ${term} OR contact.email ILIKE ${term}
      OR contact.mobile ILIKE ${term} OR contact.phone ILIKE ${term} OR contact.designation ILIKE ${term} OR location.label ILIKE ${term})`;
  }
  const defaults = await readDefaults(client, context.organizationId, supplier.id);
  const { rows } = await client.query(`${CONTACT_SELECT} WHERE ${where} ORDER BY (link.status = 'active') DESC, contact.first_name, link.created_at`, values);
  return rows.map((row) => toContact(row, defaults));
}

export const canViewContacts = (context) => supplierCan(context, SUPPLIER_PERMISSIONS.contactsView);
