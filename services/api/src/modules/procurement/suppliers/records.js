// The Supplier Master: create, change, read, list and search suppliers.
//
// One supplier per organization identity. Creating a supplier either creates
// that identity (a party of type "supplier") or adds the supplier role to an
// organization that already exists as a customer or CRM account (type
// "both"); never a second company. The party holds the identity every role
// shares: name, legal name, GSTIN, PAN, website, country, registered state,
// GST registration type. The supplier row holds what is Procurement's own.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { listPurchaseTermOptions } from "../../../core/payment-terms/index.js";
import { GST_STATES, gstStateName } from "../../../core/tax/index.js";
import {
  CONTACT_NUMBER_DOCUMENT_TYPE, GST_REGISTRATION_TYPES, PARTY_CODE_DOCUMENT_TYPE, SUPPLIER_ADDRESS_TYPES, SUPPLIER_CATEGORIES, SUPPLIER_CONTACT_ROLES,
  SUPPLIER_NUMBER_DOCUMENT_TYPE, SUPPLIER_PERMISSIONS, SUPPLIER_STATUS, SUPPLIER_STATUS_LABELS, SUPPLIER_TYPES, SUPPLIER_VIEWS, SupplierError, gstRegistrationLabel,
  has, isUuid, requireUuid, supplierAddressTypeLabel, supplierCategoryLabel, supplierContactRoleLabel, supplierTypeLabel, text,
} from "./constants.js";
import { loadSupplier, recordSupplierEvent, requireSupplierAccess, requireSupplierPermission, supplierCan, supplierCapabilities, supplierScopeSql } from "./access.js";
import {
  COMMERCIAL_FIELDS, IDENTITY_FIELDS, TAX_FIELDS, assertSupplierReferences, assertValidSupplier, completeTaxDetails, fieldLabel, normalizeSupplierInput,
} from "./validation.js";
import { assertNoBlockingSupplierDuplicate } from "./duplicates.js";
import { insertSupplierAddress } from "./addresses.js";
import { addSupplierContact } from "./contacts.js";

// supplier field -> [table alias, column]. The party holds the shared identity; the supplier row Procurement's own data.
const COLUMNS = Object.freeze({
  supplierName: ["party", "display_name"], legalName: ["party", "legal_name"], website: ["party", "website"], countryCode: ["party", "country_code"],
  gstRegistrationType: ["party", "tax_treatment"], gstin: ["party", "gstin"], pan: ["party", "pan"], registeredStateCode: ["party", "gst_state_code"],
  supplierType: ["supplier", "supplier_type"], category: ["supplier", "category"], primaryEmail: ["supplier", "primary_email"], primaryPhone: ["supplier", "primary_phone"],
  notes: ["supplier", "notes"], defaultCurrency: ["supplier", "default_currency"], paymentTermId: ["supplier", "payment_term_id"], assignedBuyerId: ["supplier", "assigned_buyer_id"],
});

// The supplier as saved, in the shape validation reads.
const currentOf = (row) => ({
  supplierName: row.display_name, legalName: row.legal_name, website: row.website, countryCode: row.country_code?.trim() ?? null, gstRegistrationType: row.tax_treatment,
  gstin: row.gstin, pan: row.pan, registeredStateCode: row.gst_state_code, supplierType: row.supplier_type, category: row.category, primaryEmail: row.primary_email,
  primaryPhone: row.primary_phone, notes: row.notes, defaultCurrency: row.default_currency?.trim() ?? null, paymentTermId: row.payment_term_id, assignedBuyerId: row.assigned_buyer_id,
});

const SELECT = `
  SELECT supplier.id, supplier.supplier_number, supplier.party_id, supplier.supplier_type, supplier.category, supplier.status, supplier.default_currency, supplier.payment_term_id,
         supplier.assigned_buyer_id, supplier.primary_email, supplier.primary_phone, supplier.notes, supplier.status_reason, supplier.status_changed_at, supplier.blocked_reason,
         supplier.blocked_at, supplier.version, supplier.created_at, supplier.updated_at, supplier.created_by,
         party.display_name, party.legal_name, party.gstin, party.pan, party.website, party.country_code, party.gst_state_code, party.tax_treatment, party.customer_number,
         term.name AS payment_term_name, term.code AS payment_term_code, buyer.full_name AS buyer_name, blocker.full_name AS blocked_by_name, changer.full_name AS status_changed_by_name,
         location.id AS location_id, location.address_type AS location_type, location.label AS location_label, location.line1 AS location_line1, location.city AS location_city,
         location.state AS location_state, location.state_code AS location_state_code, location.postal_code AS location_postal_code, location.country_code AS location_country_code,
         person.relationship_id AS primary_contact_relationship_id, person.contact_id AS primary_contact_id, person.name AS primary_contact_name, person.email AS primary_contact_email,
         person.phone AS primary_contact_phone, person.role AS primary_contact_role
    FROM tenant.procurement_suppliers supplier
    JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
    LEFT JOIN tenant.payment_terms term ON term.organization_id = supplier.organization_id AND term.id = supplier.payment_term_id
    LEFT JOIN public.users buyer ON buyer.id = supplier.assigned_buyer_id
    LEFT JOIN public.users blocker ON blocker.id = supplier.blocked_by
    LEFT JOIN public.users changer ON changer.id = supplier.status_changed_by
    LEFT JOIN LATERAL (
      SELECT address.* FROM tenant.procurement_supplier_addresses address
       WHERE address.organization_id = supplier.organization_id AND address.supplier_id = supplier.id AND address.status = 'active'
       ORDER BY address.is_primary DESC, (address.address_type = 'registered') DESC, address.created_at LIMIT 1) location ON true
    LEFT JOIN LATERAL (
      SELECT link.id AS relationship_id, contact.id AS contact_id, link.role,
             COALESCE(NULLIF(contact.display_name, ''), concat_ws(' ', contact.first_name, contact.last_name)) AS name, contact.email, COALESCE(contact.mobile, contact.phone) AS phone
        FROM tenant.procurement_supplier_contacts link
        JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
       WHERE link.organization_id = supplier.organization_id AND link.supplier_id = supplier.id AND link.status = 'active'
       ORDER BY link.is_primary DESC, link.created_at LIMIT 1) person ON true`;

export function toSupplier(row) {
  return {
    id: row.id,
    supplierNumber: row.supplier_number,
    partyId: row.party_id,
    supplierName: row.display_name,
    legalName: row.legal_name,
    supplierType: row.supplier_type,
    supplierTypeLabel: supplierTypeLabel(row.supplier_type),
    category: row.category,
    categoryLabel: supplierCategoryLabel(row.category),
    status: row.status,
    statusLabel: SUPPLIER_STATUS_LABELS[row.status] ?? row.status,
    statusReason: row.status_reason ?? null,
    statusChangedAt: row.status_changed_at ?? null,
    statusChangedByName: row.status_changed_by_name ?? null,
    blockedReason: row.blocked_reason ?? null,
    blockedAt: row.blocked_at ?? null,
    blockedByName: row.blocked_by_name ?? null,
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    website: row.website,
    countryCode: row.country_code?.trim() ?? null,
    notes: row.notes,
    gstRegistrationType: row.tax_treatment,
    gstRegistrationLabel: row.tax_treatment ? gstRegistrationLabel(row.tax_treatment) : null,
    gstin: row.gstin,
    pan: row.pan,
    registeredStateCode: row.gst_state_code,
    registeredStateName: row.gst_state_code ? gstStateName(row.gst_state_code) : null,
    defaultCurrency: row.default_currency?.trim() ?? null,
    paymentTermId: row.payment_term_id,
    paymentTermName: row.payment_term_name ?? null,
    assignedBuyerId: row.assigned_buyer_id,
    assignedBuyerName: row.buyer_name ?? null,
    isCustomer: Boolean(row.customer_number),
    customerNumber: row.customer_number ?? null,
    primaryAddress: row.location_id ? {
      id: row.location_id, addressType: row.location_type, addressTypeLabel: supplierAddressTypeLabel(row.location_type), label: row.location_label, line1: row.location_line1,
      city: row.location_city, state: row.location_state, stateCode: row.location_state_code, postalCode: row.location_postal_code, countryCode: row.location_country_code?.trim() ?? null,
    } : null,
    primaryContact: row.primary_contact_id ? {
      relationshipId: row.primary_contact_relationship_id, contactId: row.primary_contact_id, name: row.primary_contact_name, email: row.primary_contact_email,
      phone: row.primary_contact_phone, role: row.primary_contact_role, roleLabel: supplierContactRoleLabel(row.primary_contact_role),
    } : null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readSupplierRow(client, organizationId, supplierId) {
  const { rows } = await client.query(`${SELECT} WHERE supplier.organization_id = $1 AND supplier.id = $2`, [organizationId, supplierId]);
  if (!rows[0]) throw new SupplierError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  return rows[0];
}

// What may be done to this supplier now, for the screen. Each action checks again on the server.
function supplierActions(context, supplier) {
  const can = (permission) => supplierCan(context, permission);
  const active = supplier.status === SUPPLIER_STATUS.active;
  return {
    edit: can(SUPPLIER_PERMISSIONS.edit) || can(SUPPLIER_PERMISSIONS.tax) || can(SUPPLIER_PERMISSIONS.commercial),
    createPurchaseOrder: active && can(SUPPLIER_PERMISSIONS.createPurchaseOrder),
    deactivate: active && can(SUPPLIER_PERMISSIONS.status),
    activate: supplier.status === SUPPLIER_STATUS.inactive && can(SUPPLIER_PERMISSIONS.status),
    block: supplier.status !== SUPPLIER_STATUS.blocked && can(SUPPLIER_PERMISSIONS.block),
    unblock: supplier.status === SUPPLIER_STATUS.blocked && can(SUPPLIER_PERMISSIONS.block),
    manageAddresses: can(SUPPLIER_PERMISSIONS.addresses),
    manageContacts: can(SUPPLIER_PERMISSIONS.contacts),
    viewPayables: can(SUPPLIER_PERMISSIONS.payablesView),
    viewPaymentDetails: can(SUPPLIER_PERMISSIONS.paymentDetailsView) || can(SUPPLIER_PERMISSIONS.paymentDetailsManage),
    managePaymentDetails: can(SUPPLIER_PERMISSIONS.paymentDetailsManage),
  };
}

export async function getSupplier(client, context, supplierId) {
  const scoped = await loadSupplier(client, context, supplierId);
  const supplier = toSupplier(await readSupplierRow(client, context.organizationId, scoped.id));
  const addresses = (await client.query(
    `SELECT * FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2
      ORDER BY (status = 'active') DESC, is_primary DESC, address_type, created_at`, [context.organizationId, supplier.id])).rows.map(toAddress);
  const contacts = (await client.query(
    `SELECT link.id, link.contact_id, link.role, link.is_primary, link.status, contact.contact_number, contact.first_name, contact.last_name,
            COALESCE(NULLIF(contact.display_name, ''), concat_ws(' ', contact.first_name, contact.last_name)) AS name, contact.designation, contact.email, contact.phone, contact.mobile
       FROM tenant.procurement_supplier_contacts link
       JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
      WHERE link.organization_id = $1 AND link.supplier_id = $2
      ORDER BY (link.status = 'active') DESC, link.is_primary DESC, link.created_at`, [context.organizationId, supplier.id])).rows.map(toContact);
  return { supplier, addresses, contacts, actions: supplierActions(context, supplier), capabilities: supplierCapabilities(context) };
}

export const toAddress = (row) => ({
  id: row.id, addressType: row.address_type, addressTypeLabel: supplierAddressTypeLabel(row.address_type), label: row.label, line1: row.line1, line2: row.line2, city: row.city,
  district: row.district, state: row.state, stateCode: row.state_code, postalCode: row.postal_code, countryCode: row.country_code?.trim() ?? null,
  gstRegistrationType: row.gst_registration_type, gstRegistrationLabel: row.gst_registration_type ? gstRegistrationLabel(row.gst_registration_type) : null, gstin: row.gstin,
  isPrimary: row.is_primary, status: row.status,
});

export const toContact = (row) => ({
  id: row.id, contactId: row.contact_id, contactNumber: row.contact_number, name: row.name, firstName: row.first_name, lastName: row.last_name, designation: row.designation,
  email: row.email, phone: row.phone, mobile: row.mobile, role: row.role, roleLabel: supplierContactRoleLabel(row.role), isPrimary: row.is_primary, status: row.status,
});

// ------------------------------------------------------------------ create

// input: the supplier fields; partyId to add the supplier role to an existing organization (a customer or CRM account);
// address (the first location, registered unless said otherwise); primaryContact { firstName, lastName, email, phone, designation, role };
// allowDuplicate + duplicateReason to save despite a strong match; status ("active" | "inactive"); origin (recorded in the history).
export async function createSupplier(client, context, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.create, "You do not have permission to create suppliers.");
  const normalized = normalizeSupplierInput(input);
  const status = text(input.status) ?? SUPPLIER_STATUS.active;
  if (![SUPPLIER_STATUS.active, SUPPLIER_STATUS.inactive].includes(status))
    throw new SupplierError(400, "A new supplier is Active or Inactive.", "SUPPLIER_VALIDATION", { issues: [{ field: "status", message: "Choose Active or Inactive." }] });

  // Adding the supplier role to an organization that already exists keeps its identity.
  let party = null;
  if (input.partyId) {
    party = (await client.query(
      `SELECT party.*, supplier.supplier_number FROM tenant.business_parties party
         LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = party.organization_id AND supplier.party_id = party.id
        WHERE party.organization_id = $1 AND party.id = $2 FOR UPDATE OF party`, [context.organizationId, requireUuid(input.partyId, "Organization")])).rows[0];
    if (!party) throw new SupplierError(404, "That organization was not found.", "SUPPLIER_PARTY_NOT_FOUND");
    if (party.status === "archived") throw new SupplierError(409, `${party.display_name} is archived.`, "SUPPLIER_PARTY_ARCHIVED");
    if (party.supplier_number) throw new SupplierError(409, `${party.display_name} is already supplier ${party.supplier_number}.`, "SUPPLIER_ALREADY_EXISTS");
  }
  const organization = (await client.query(`SELECT btrim(base_currency) AS currency, country_code FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
  const fromParty = party ? {
    supplierName: party.display_name, legalName: party.legal_name, website: party.website, countryCode: party.country_code?.trim() ?? null, gstRegistrationType: party.tax_treatment,
    gstin: party.gstin, pan: party.pan, registeredStateCode: party.gst_state_code,
  } : {};
  // The party's identity wins where it already has a value: adding a role never rewrites the company.
  const candidate = completeTaxDetails({
    supplierType: "business", countryCode: organization.country_code ?? "IN", defaultCurrency: organization.currency ?? null,
    ...normalized, ...Object.fromEntries(Object.entries(fromParty).filter(([, value]) => value !== null && value !== undefined)),
  });
  candidate.legalName ??= candidate.supplierName;
  assertValidSupplier(candidate);
  await assertSupplierReferences(client, context, candidate);
  const duplicates = await assertNoBlockingSupplierDuplicate(client, context, {
    supplierName: candidate.supplierName, legalName: candidate.legalName, gstin: candidate.gstin, pan: candidate.pan, website: candidate.website,
    primaryEmail: candidate.primaryEmail, primaryPhone: candidate.primaryPhone, city: input.address?.city,
  }, { allowDuplicate: input.allowDuplicate === true, reason: input.duplicateReason, excludePartyId: party?.id ?? null });

  const numbering = { organizationId: context.organizationId };
  let partyId = party?.id ?? null;
  if (party) {
    const fills = Object.entries(COLUMNS).filter(([field, [table]]) => table === "party" && candidate[field] && !fromParty[field]);
    const sets = [`party_type = CASE WHEN party_type = 'supplier' THEN 'supplier' ELSE 'both' END`, "updated_by = $3", "updated_at = now()",
      ...fills.map(([, [, column]], index) => `${column} = $${index + 4}`)];
    await client.query(`UPDATE tenant.business_parties SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, party.id, context.userId ?? null, ...fills.map(([field]) => candidate[field])]);
  } else {
    const code = await nextDocumentNumber(client, numbering, { documentType: PARTY_CODE_DOCUMENT_TYPE });
    const fields = Object.entries(COLUMNS).filter(([field, [table]]) => table === "party" && candidate[field] !== null && candidate[field] !== undefined);
    const columns = ["organization_id", "code", "party_type", "account_type", "status", "created_by", "updated_by", ...fields.map(([, [, column]]) => column)];
    const values = [context.organizationId, code, "supplier", "other", "active", context.userId ?? null, context.userId ?? null, ...fields.map(([field]) => candidate[field])];
    partyId = (await client.query(
      `INSERT INTO tenant.business_parties (${columns.join(", ")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`, values)).rows[0].id;
  }
  const supplierNumber = await nextDocumentNumber(client, numbering, { documentType: SUPPLIER_NUMBER_DOCUMENT_TYPE });
  const own = Object.entries(COLUMNS).filter(([field, [table]]) => table === "supplier" && candidate[field] !== null && candidate[field] !== undefined);
  const columns = ["organization_id", "supplier_number", "party_id", "status", "search_text", "data", "content_hash", "created_by", "updated_by", "status_changed_at", "status_changed_by",
    ...own.map(([, [, column]]) => column)];
  const values = [context.organizationId, supplierNumber, partyId, status, `${supplierNumber} ${candidate.supplierName}`, "{}", "", context.userId, context.userId, new Date(), context.userId ?? null,
    ...own.map(([field]) => candidate[field])];
  const supplierId = (await client.query(
    `INSERT INTO tenant.procurement_suppliers (${columns.join(", ")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`, values)).rows[0].id;

  const strong = duplicates.filter((match) => match.strength === "strong");
  await recordSupplierEvent(client, context, supplierId, "supplier.created",
    party ? `Supplier ${supplierNumber} created for ${candidate.supplierName}${party.customer_number ? `, also customer ${party.customer_number}` : ""}` : `Supplier ${supplierNumber} created`,
    { origin: text(input.origin) ?? "procurement", status, ...(strong.length ? { createdDespite: strong.map((match) => match.number ?? match.name), reason: text(input.duplicateReason) } : {}) });
  if (input.address && typeof input.address === "object")
    await insertSupplierAddress(client, context, supplierId, { addressType: "registered", ...input.address, isPrimary: true }, { record: false });
  if (input.primaryContact && text(input.primaryContact.firstName))
    await addSupplierContact(client, context, supplierId, { role: "procurement", ...input.primaryContact, isPrimary: true }, { record: false, skipPermission: true });
  return getSupplier(client, context, supplierId);
}

// ------------------------------------------------------------------ update

const EVENTS = Object.freeze({
  supplierName: ["supplier.name_changed", "Supplier name"], legalName: ["supplier.legal_name_changed", "Legal name"], gstin: ["supplier.gstin_changed", "GSTIN"],
  defaultCurrency: ["supplier.currency_changed", "Default currency"], paymentTermId: ["supplier.payment_terms_changed", "Payment terms"], assignedBuyerId: ["supplier.buyer_changed", "Buyer"],
});

// input: any supplier fields, plus expectedVersion. Identity needs Edit suppliers, tax details Manage supplier tax information, the
// currency, payment terms and buyer Manage supplier commercial defaults. Documents already created keep what they were given.
export async function updateSupplier(client, context, supplierId, input = {}) {
  const row = await loadSupplier(client, context, supplierId, { lock: true });
  if (has(input, "expectedVersion") && Number(input.expectedVersion) !== Number(row.version))
    throw new SupplierError(409, "This supplier was changed by someone else. Reload it and try again.", "SUPPLIER_VERSION_CONFLICT");
  const current = currentOf(row);
  const normalized = normalizeSupplierInput(input);
  const changed = Object.keys(normalized).filter((field) => (normalized[field] ?? null) !== (current[field] ?? null));
  if (!changed.length) return getSupplier(client, context, row.id);
  const groups = [
    [IDENTITY_FIELDS, SUPPLIER_PERMISSIONS.edit, "You do not have permission to edit suppliers."],
    [TAX_FIELDS, SUPPLIER_PERMISSIONS.tax, "You do not have permission to change supplier tax information."],
    [COMMERCIAL_FIELDS, SUPPLIER_PERMISSIONS.commercial, "You do not have permission to change supplier commercial defaults."],
  ];
  for (const [fields, permission, message] of groups) if (changed.some((field) => fields.includes(field))) requireSupplierPermission(context, permission, message);

  const candidate = { ...current, ...normalized };
  if (changed.includes("gstin")) { if (!has(normalized, "registeredStateCode")) candidate.registeredStateCode = null; if (!has(normalized, "pan")) candidate.pan = null; }
  completeTaxDetails(candidate);
  candidate.legalName ??= candidate.supplierName;
  assertValidSupplier(candidate);
  await assertSupplierReferences(client, context, candidate, changed);
  if (changed.some((field) => ["supplierName", "legalName", "gstin", "pan"].includes(field)))
    await assertNoBlockingSupplierDuplicate(client, context, {
      supplierName: changed.includes("supplierName") ? candidate.supplierName : null, legalName: changed.includes("legalName") ? candidate.legalName : null,
      gstin: changed.includes("gstin") ? candidate.gstin : null, pan: changed.includes("pan") ? candidate.pan : null,
    }, { allowDuplicate: input.allowDuplicate === true, reason: input.duplicateReason, excludeSupplierId: row.id, excludePartyId: row.party_id });

  const finalChanged = Object.keys(COLUMNS).filter((field) => (candidate[field] ?? null) !== (current[field] ?? null));
  // The party's identity columns, then the supplier's own (whose version and search text change with any edit).
  const write = async (table, tableName, id, extra = []) => {
    const values = [context.organizationId, id];
    const bind = (value) => `$${values.push(value)}`;
    const sets = finalChanged.filter((field) => COLUMNS[field][0] === table).map((field) => `${COLUMNS[field][1]} = ${bind(candidate[field] ?? null)}`);
    if (!sets.length && !extra.length) return;
    sets.push(...extra.map(([sql, value]) => (value === undefined ? sql : `${sql} = ${bind(value)}`)), `updated_by = ${bind(context.userId ?? null)}`, "updated_at = now()");
    await client.query(`UPDATE tenant.${tableName} SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`, values);
  };
  await write("party", "business_parties", row.party_id);
  await write("supplier", "procurement_suppliers", row.id, [["version = version + 1"], ["search_text", `${row.supplier_number} ${candidate.supplierName}`]]);

  // The business events, one each; the minor details together.
  const names = await describeReferences(client, context, current, candidate);
  for (const field of finalChanged.filter((entry) => EVENTS[entry])) {
    const [eventType, label] = EVENTS[field];
    await recordSupplierEvent(client, context, row.id, eventType, `${label}: ${names.from(field) ?? "none"} → ${names.to(field) ?? "none"}`, { field, from: current[field] ?? null, to: candidate[field] ?? null });
  }
  const taxRest = finalChanged.filter((field) => TAX_FIELDS.includes(field) && !EVENTS[field]);
  if (taxRest.length)
    await recordSupplierEvent(client, context, row.id, "supplier.tax_changed", `Tax details changed: ${taxRest.map(fieldLabel).join(", ")}`,
      Object.fromEntries(taxRest.map((field) => [field, { from: current[field] ?? null, to: candidate[field] ?? null }])));
  const rest = finalChanged.filter((field) => !EVENTS[field] && !TAX_FIELDS.includes(field));
  if (rest.length)
    await recordSupplierEvent(client, context, row.id, "supplier.details_changed", `Details changed: ${rest.map(fieldLabel).join(", ")}`,
      Object.fromEntries(rest.filter((field) => field !== "notes").map((field) => [field, { from: current[field] ?? null, to: candidate[field] ?? null }])));
  return getSupplier(client, context, row.id);
}

// Names for the ids in a change, for the history.
async function describeReferences(client, context, before, after) {
  const ids = [before.paymentTermId, after.paymentTermId].filter(isUuid);
  const users = [before.assignedBuyerId, after.assignedBuyerId].filter(isUuid);
  const terms = ids.length ? (await client.query(`SELECT id, name FROM tenant.payment_terms WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [context.organizationId, ids])).rows : [];
  const people = users.length ? (await client.query(`SELECT id, full_name FROM public.users WHERE id = ANY($1::uuid[])`, [users])).rows : [];
  const show = (field, value) => (field === "paymentTermId" ? terms.find((term) => term.id === value)?.name : field === "assignedBuyerId" ? people.find((user) => user.id === value)?.full_name : value) ?? null;
  return { from: (field) => show(field, before[field]), to: (field) => show(field, after[field]) };
}

// ------------------------------------------------------------------ list and search

const SORTS = Object.freeze({
  number: "supplier.supplier_number", name: "lower(party.display_name)", category: "supplier.category", status: "supplier.status", updated: "supplier.updated_at",
  buyer: "buyer.full_name", city: "location.city",
});

// filters: view (all | active | inactive | blocked | mine), search, status, category, buyerId, countryCode, stateCode, currency, paymentTermId,
//          gstRegistrationType, sort, direction, limit, offset
export async function listSuppliers(client, context, filters = {}) {
  requireSupplierAccess(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = `supplier.organization_id = $1${supplierScopeSql(context, values, "supplier")}`;
  switch (filters.view) {
    case "active": case "inactive": case "blocked": where += ` AND supplier.status = '${filters.view}'`; break;
    case "mine": where += ` AND supplier.assigned_buyer_id = ${bind(context.userId ?? null)}`; break;
    default: break;
  }
  if (Object.values(SUPPLIER_STATUS).includes(filters.status)) where += ` AND supplier.status = ${bind(filters.status)}`;
  if (SUPPLIER_CATEGORIES.some((entry) => entry.code === filters.category)) where += ` AND supplier.category = ${bind(filters.category)}`;
  if (isUuid(filters.buyerId)) where += ` AND supplier.assigned_buyer_id = ${bind(filters.buyerId)}`;
  if (filters.buyerId === "none") where += " AND supplier.assigned_buyer_id IS NULL";
  if (/^[A-Z]{2}$/i.test(filters.countryCode ?? "")) where += ` AND party.country_code = ${bind(filters.countryCode.toUpperCase())}`;
  if (/^[0-9]{2}$/.test(filters.stateCode ?? "")) where += ` AND COALESCE(location.state_code, party.gst_state_code) = ${bind(filters.stateCode)}`;
  if (/^[A-Z]{3}$/i.test(filters.currency ?? "")) where += ` AND supplier.default_currency = ${bind(filters.currency.toUpperCase())}`;
  if (isUuid(filters.paymentTermId)) where += ` AND supplier.payment_term_id = ${bind(filters.paymentTermId)}`;
  if (GST_REGISTRATION_TYPES.some((entry) => entry.code === filters.gstRegistrationType)) where += ` AND party.tax_treatment = ${bind(filters.gstRegistrationType)}`;
  const search = text(filters.search, 200);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    const digits = search.replace(/[^0-9]/g, "");
    where += ` AND (supplier.supplier_number ILIKE ${term} OR party.display_name ILIKE ${term} OR party.legal_name ILIKE ${term} OR party.gstin ILIKE ${term}
      OR party.pan ILIKE ${term} OR supplier.primary_email ILIKE ${term} OR party.website ILIKE ${term}
      ${digits.length >= 6 ? `OR supplier.normalized_phone LIKE ${bind(`%${digits.slice(-10)}%`)}` : ""}
      OR EXISTS (SELECT 1 FROM tenant.procurement_supplier_addresses address WHERE address.organization_id = supplier.organization_id AND address.supplier_id = supplier.id
                  AND (address.city ILIKE ${term} OR address.gstin ILIKE ${term} OR address.state ILIKE ${term})))`;
  }
  const sort = SORTS[filters.sort] ?? SORTS.number;
  const direction = filters.direction === "desc" ? "DESC" : "ASC";
  const limit = Math.min(500, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const countValues = [...values];
  const rows = (await client.query(`${SELECT} WHERE ${where} ORDER BY ${sort} ${direction} NULLS LAST, supplier.supplier_number LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  const total = (await client.query(`SELECT count(*)::int AS total FROM (${SELECT} WHERE ${where}) counted`, countValues)).rows[0].total;
  return { rows: rows.map(toSupplier), total, limit, offset, views: SUPPLIER_VIEWS };
}

// The supplier picker on procurement documents: name, number, legal name, GSTIN, email, phone or city. Every supplier the caller may
// see is returned, so the wrong one is never picked by mistake; inactive and blocked ones say why they cannot be used.
export async function searchSuppliers(client, context, { search = "", limit = 20 } = {}) {
  const { rows } = await listSuppliers(client, context, { search, limit, sort: "name" });
  return rows.map((supplier) => ({
    id: supplier.id, supplierNumber: supplier.supplierNumber, supplierName: supplier.supplierName, legalName: supplier.legalName, gstin: supplier.gstin,
    city: supplier.primaryAddress?.city ?? null, state: supplier.primaryAddress?.state ?? supplier.registeredStateName ?? null, countryCode: supplier.countryCode,
    status: supplier.status, statusLabel: supplier.statusLabel, selectable: supplier.status === SUPPLIER_STATUS.active,
    unavailableReason: supplier.status === SUPPLIER_STATUS.blocked ? `Blocked: ${supplier.blockedReason}. Cannot be selected for a new document.`
      : supplier.status === SUPPLIER_STATUS.inactive ? "Inactive. Cannot be selected for a new document." : null,
  }));
}

// What the supplier form offers: the tenant's currencies, purchase payment terms and users, and the fixed lists.
export async function getSupplierFormOptions(client, context) {
  requireSupplierAccess(context);
  const organization = (await client.query(`SELECT btrim(base_currency) AS currency, country_code FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
  const currencies = (await client.query(`SELECT btrim(code) AS code, name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`,
    [context.organizationId])).rows;
  const buyers = (await client.query(
    `SELECT users.id, users.full_name AS name, users.email FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.status = 'active' AND users.status = 'active' ORDER BY users.full_name`, [context.organizationId])).rows;
  return {
    baseCurrency: organization.currency ?? null, countryCode: organization.country_code ?? "IN", currencies, paymentTerms: await listPurchaseTermOptions(client, context.organizationId),
    buyers, types: SUPPLIER_TYPES, categories: SUPPLIER_CATEGORIES, gstRegistrationTypes: GST_REGISTRATION_TYPES, addressTypes: SUPPLIER_ADDRESS_TYPES,
    contactRoles: SUPPLIER_CONTACT_ROLES, states: GST_STATES.map(([code, name]) => ({ code, name })), statuses: Object.entries(SUPPLIER_STATUS_LABELS).map(([code, label]) => ({ code, label })),
    views: SUPPLIER_VIEWS, capabilities: supplierCapabilities(context),
  };
}

export { CONTACT_NUMBER_DOCUMENT_TYPE };
