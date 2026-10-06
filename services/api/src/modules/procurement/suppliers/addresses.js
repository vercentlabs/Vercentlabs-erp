// A supplier's locations: the registered office, ordering and billing
// offices, the places goods ship from and return to, plants and branches.
// One place may serve several purposes, so a head office that is the
// registered, ordering and billing address is one record with three
// purposes. A location links to the GST registration it trades under.
// Documents keep the location they used and a snapshot of it, so changing or
// deactivating a location never changes an old document. A location is
// never deleted: an old one is deactivated and stops being offered.
import {
  EMAIL_PATTERN, LEGACY_ADDRESS_TYPE, SUPPLIER_ADDRESS_PURPOSES, SUPPLIER_PERMISSIONS, SupplierError, has, isUuid, requireUuid, supplierAddressPurposeLabel, text,
} from "./constants.js";
import { loadSupplier, recordSupplierEvent, requireSupplierPermission, supplierCan } from "./access.js";
import { ADDRESS_DEFAULT_COLUMNS, assignDefault, clearDefaultsFor, readDefaults } from "./default-assignments.js";
import { ensureRegistration, normalizeGstin } from "./tax-registrations.js";
import { gstStateName } from "../../../core/tax/index.js";

const PURPOSE_ORDER = SUPPLIER_ADDRESS_PURPOSES.map((entry) => entry.code);
const OPEN_ORDERS = ["draft", "submitted", "pending_approval", "approved", "dispatched", "acknowledged", "partially_received", "pending_amendment_approval"];

function fail(field, message, code = "SUPPLIER_ADDRESS_VALIDATION") {
  throw new SupplierError(400, message, code, { issues: [{ field, message }] });
}

export const ADDRESS_SELECT = `
  SELECT address.*,
         COALESCE((SELECT array_agg(purpose.purpose) FROM tenant.procurement_supplier_address_purposes purpose
                    WHERE purpose.organization_id = address.organization_id AND purpose.address_id = address.id), '{}') AS purposes,
         registration.gstin AS registration_gstin, registration.registration_type, registration.state_code AS registration_state_code,
         registration.status AS registration_status, registration.is_principal AS registration_is_principal
    FROM tenant.procurement_supplier_addresses address
    LEFT JOIN tenant.procurement_supplier_tax_registrations registration
           ON registration.organization_id = address.organization_id AND registration.id = address.tax_registration_id`;

// defaults: the supplier's defaults row, to say which purposes this location is the default for.
export function toAddress(row, defaults = {}) {
  const purposes = [...row.purposes].sort((left, right) => PURPOSE_ORDER.indexOf(left) - PURPOSE_ORDER.indexOf(right));
  return {
    id: row.id, label: row.label, purposes, purposeLabels: purposes.map(supplierAddressPurposeLabel),
    defaultFor: Object.entries(ADDRESS_DEFAULT_COLUMNS).filter(([, column]) => defaults[column] === row.id).map(([purpose]) => purpose),
    line1: row.line1, line2: row.line2, locality: row.locality, city: row.city, district: row.district, state: row.state, stateCode: row.state_code,
    stateName: row.state_code ? gstStateName(row.state_code) : null, postalCode: row.postal_code, countryCode: row.country_code?.trim() ?? null,
    locationEmail: row.location_email, locationPhone: row.location_phone,
    taxRegistration: row.tax_registration_id ? { id: row.tax_registration_id, gstin: row.registration_gstin, registrationType: row.registration_type,
      stateCode: row.registration_state_code, status: row.registration_status, isPrincipal: row.registration_is_principal } : null,
    status: row.status, updatedAt: row.updated_at,
  };
}

// "Nashik Plant · Nashik, Maharashtra · GSTIN 27…": what a selector shows.
export const describeAddress = (address) =>
  [address.label, [address.city, address.state ?? address.stateName].filter(Boolean).join(", "), address.taxRegistration?.gstin ? `GSTIN ${address.taxRegistration.gstin}` : null]
    .filter(Boolean).join(" · ");

function normalizePurposes(value) {
  const list = [...new Set((Array.isArray(value) ? value : []).map((entry) => String(entry)))];
  if (!list.length) fail("purposes", "Choose what the location is used for.");
  const unknown = list.find((purpose) => !PURPOSE_ORDER.includes(purpose));
  if (unknown) fail("purposes", `"${unknown}" is not an address purpose.`);
  return list.sort((left, right) => PURPOSE_ORDER.indexOf(left) - PURPOSE_ORDER.indexOf(right));
}

function normalizeAddress(input = {}, current = {}) {
  const pick = (field, max = 200) => (has(input, field) ? text(input[field], max) : current[field] ?? null);
  const address = {
    line1: pick("line1", 300), line2: pick("line2", 300), locality: pick("locality", 120), city: pick("city", 120), district: pick("district", 120), state: pick("state", 120),
    stateCode: pick("stateCode", 2), postalCode: pick("postalCode", 20), countryCode: (pick("countryCode", 2) ?? "IN").toUpperCase(),
    locationEmail: pick("locationEmail", 254)?.toLowerCase() ?? null, locationPhone: pick("locationPhone", 40),
  };
  address.purposes = has(input, "purposes") ? normalizePurposes(input.purposes) : current.purposes ?? normalizePurposes([]);
  address.label = pick("label", 120) ?? `${address.city ?? "Location"} ${supplierAddressPurposeLabel(address.purposes[0]).split(" /")[0]}`.trim();
  if (!address.line1) fail("line1", "Enter the address.");
  if (!address.city) fail("city", "Enter the city.");
  if (!/^[A-Z]{2}$/.test(address.countryCode)) fail("countryCode", "Choose the country.");
  if (address.stateCode && !/^[0-9]{2}$/.test(address.stateCode)) fail("stateCode", "Choose the state.");
  if (address.locationEmail && !EMAIL_PATTERN.test(address.locationEmail)) fail("locationEmail", "Enter a valid email address.");
  if (address.locationPhone && (address.locationPhone.replace(/[^0-9]/g, "").length < 6 || !/^[0-9+()\-\s.]+$/.test(address.locationPhone)))
    fail("locationPhone", "Enter a valid phone number.");
  return address;
}

// The registration a location trades under: an existing one of this supplier, a GSTIN (found or added), or none.
async function resolveRegistration(client, context, supplier, input, current) {
  if (has(input, "taxRegistrationId")) {
    if (!input.taxRegistrationId) return null;
    const row = (await client.query(`SELECT id, state_code, status FROM tenant.procurement_supplier_tax_registrations WHERE organization_id = $1 AND supplier_id = $2 AND id = $3`,
      [context.organizationId, supplier.id, requireUuid(input.taxRegistrationId, "Registration")])).rows[0];
    if (!row) fail("taxRegistrationId", "Choose one of this supplier's GST registrations.");
    if (row.status !== "active" && row.id !== current) fail("taxRegistrationId", "That registration is inactive.");
    return row.id;
  }
  if (has(input, "gstin")) {
    const gstin = normalizeGstin(input.gstin);
    if (!gstin) return null;
    return (await ensureRegistration(client, context, supplier, gstin, { registrationType: text(input.registrationType) ?? "registered_regular" })).id;
  }
  return current ?? null;
}

// Likely the same place already on file: the same address once punctuation and case are ignored, or the same PIN with the same street.
export async function checkSupplierAddressDuplicates(client, context, supplierId, input = {}, exceptAddressId = null) {
  const candidate = `${input.line1 ?? ""} ${input.line2 ?? ""} ${input.city ?? ""} ${input.postalCode ?? ""} ${input.countryCode ?? "IN"}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const street = String(input.line1 ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 12);
  if (!candidate || !input.line1) return [];
  const { rows } = await client.query(
    `SELECT id, label, city, status, (normalized_address = $3) AS same FROM tenant.procurement_supplier_addresses
      WHERE organization_id = $1 AND supplier_id = $2 AND ($4::uuid IS NULL OR id <> $4::uuid)
        AND (normalized_address = $3 OR ($5::text <> '' AND postal_code IS NOT NULL AND postal_code = $5
             AND left(lower(regexp_replace(line1, '[^[:alnum:]]+', '', 'g')), 12) = $6))`,
    [context.organizationId, supplierId, candidate, exceptAddressId, text(input.postalCode) ?? "", street]);
  return rows.map((row) => ({ addressId: row.id, label: row.label, city: row.city, status: row.status, reason: row.same ? "Same address" : "Same PIN code and street" }));
}

async function writePurposes(client, context, supplierId, addressId, purposes) {
  await client.query(`DELETE FROM tenant.procurement_supplier_address_purposes WHERE organization_id = $1 AND address_id = $2 AND NOT (purpose = ANY($3::text[]))`,
    [context.organizationId, addressId, purposes]);
  await client.query(
    `INSERT INTO tenant.procurement_supplier_address_purposes (organization_id, supplier_id, address_id, purpose) SELECT $1, $2, $3, unnest($4::text[]) ON CONFLICT DO NOTHING`,
    [context.organizationId, supplierId, addressId, purposes]);
}

// defaults: the purposes this location becomes the default for (each must be one of its purposes).
async function applyDefaults(client, context, supplierId, addressId, label, purposes, requested, { record = true } = {}) {
  const wanted = [...new Set(requested)];
  const bad = wanted.find((purpose) => !purposes.includes(purpose) || !ADDRESS_DEFAULT_COLUMNS[purpose]);
  if (bad) fail("defaults", `A default ${supplierAddressPurposeLabel(bad)} address must be used for ${supplierAddressPurposeLabel(bad)}.`);
  for (const purpose of wanted) await assignDefault(client, context, supplierId, "address", purpose, { id: addressId, name: label }, { record });
}

// Used by createSupplier and import (record: false: their own event says it) and by Add Address. Returns { addressId, warnings }.
export async function insertSupplierAddress(client, context, supplierId, input = {}, { record = true } = {}) {
  const supplier = (await client.query(`SELECT id, party_id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplierId])).rows[0];
  if (!supplier) throw new SupplierError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  const address = normalizeAddress(input);
  const warnings = await checkSupplierAddressDuplicates(client, context, supplier.id, address);
  const registrationId = await resolveRegistration(client, context, supplier, input, null);
  if (registrationId && !address.stateCode)
    address.stateCode = (await client.query(`SELECT state_code FROM tenant.procurement_supplier_tax_registrations WHERE id = $1`, [registrationId])).rows[0].state_code;
  const id = (await client.query(
    `INSERT INTO tenant.procurement_supplier_addresses (organization_id, supplier_id, address_type, label, line1, line2, locality, city, district, state, state_code, postal_code, country_code,
       location_email, location_phone, tax_registration_id, is_primary, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, false, $17, $17) RETURNING id`,
    [context.organizationId, supplier.id, LEGACY_ADDRESS_TYPE[address.purposes[0]], address.label, address.line1, address.line2, address.locality, address.city, address.district,
      address.state, address.stateCode, address.postalCode, address.countryCode, address.locationEmail, address.locationPhone, registrationId, context.userId ?? null])).rows[0].id;
  await writePurposes(client, context, supplier.id, id, address.purposes);
  // The first location for a purpose becomes its default, unless the caller chose otherwise.
  const current = await readDefaults(client, context.organizationId, supplier.id);
  const automatic = address.purposes.filter((purpose) => ADDRESS_DEFAULT_COLUMNS[purpose] && !current[ADDRESS_DEFAULT_COLUMNS[purpose]]);
  const requested = Array.isArray(input.defaults) ? input.defaults : automatic;
  await applyDefaults(client, context, supplier.id, id, address.label, address.purposes, requested, { record });
  if (record)
    await recordSupplierEvent(client, context, supplier.id, "supplier.address_added",
      `Address added: ${address.label} (${address.purposes.map(supplierAddressPurposeLabel).join(", ")}), ${address.city}`, { addressId: id, registrationId });
  return { addressId: id, warnings };
}

export async function addSupplierAddress(client, context, supplierId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.addresses, "You do not have permission to manage supplier addresses.");
  if (has(input, "gstin") || has(input, "taxRegistrationId")) {
    if (input.gstin || input.taxRegistrationId) requireSupplierPermission(context, SUPPLIER_PERMISSIONS.tax, "You do not have permission to link supplier tax registrations.");
  }
  if (Array.isArray(input.defaults) && input.defaults.length) requireSupplierPermission(context, SUPPLIER_PERMISSIONS.defaults, "You do not have permission to set supplier defaults.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  return insertSupplierAddress(client, context, supplier.id, input);
}

async function loadAddress(client, context, supplier, addressId) {
  const row = (await client.query(`${ADDRESS_SELECT} WHERE address.organization_id = $1 AND address.supplier_id = $2 AND address.id = $3 FOR UPDATE OF address`,
    [context.organizationId, supplier.id, requireUuid(addressId, "Address")])).rows[0];
  if (!row) throw new SupplierError(404, "Address not found.", "SUPPLIER_ADDRESS_NOT_FOUND");
  return row;
}

const FIELDS = ["label", "line1", "line2", "locality", "city", "district", "state", "stateCode", "postalCode", "countryCode", "locationEmail", "locationPhone"];
const fromRow = (row) => ({
  label: row.label, line1: row.line1, line2: row.line2, locality: row.locality, city: row.city, district: row.district, state: row.state, stateCode: row.state_code,
  postalCode: row.postal_code, countryCode: row.country_code?.trim(), locationEmail: row.location_email, locationPhone: row.location_phone, purposes: [...row.purposes],
});

// input: any address fields, purposes, the registration (taxRegistrationId or gstin), and defaults (the full list of purposes it is the default for).
// Returns { addressId, warnings }. Documents that used the old address keep their snapshot.
export async function updateSupplierAddress(client, context, supplierId, addressId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.addresses, "You do not have permission to manage supplier addresses.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = await loadAddress(client, context, supplier, addressId);
  if (row.status !== "active") throw new SupplierError(409, "Reactivate this address before changing it.", "SUPPLIER_ADDRESS_INACTIVE");
  const before = fromRow(row);
  const address = normalizeAddress(input, before);
  const registrationTouched = has(input, "gstin") || has(input, "taxRegistrationId");
  const registrationId = registrationTouched ? await resolveRegistration(client, context, supplier, input, row.tax_registration_id) : row.tax_registration_id;
  if (registrationId !== row.tax_registration_id) requireSupplierPermission(context, SUPPLIER_PERMISSIONS.tax, "You do not have permission to link supplier tax registrations.");
  const changed = FIELDS.filter((field) => (address[field] ?? null) !== (before[field] ?? null));
  const purposesChanged = address.purposes.join() !== [...before.purposes].sort((a, b) => PURPOSE_ORDER.indexOf(a) - PURPOSE_ORDER.indexOf(b)).join();
  const warnings = changed.some((field) => ["line1", "line2", "city", "postalCode", "countryCode"].includes(field))
    ? await checkSupplierAddressDuplicates(client, context, supplier.id, address, row.id) : [];
  await client.query(
    `UPDATE tenant.procurement_supplier_addresses SET address_type = $4, label = $5, line1 = $6, line2 = $7, locality = $8, city = $9, district = $10, state = $11, state_code = $12,
            postal_code = $13, country_code = $14, location_email = $15, location_phone = $16, tax_registration_id = $17, updated_by = $18, updated_at = now()
      WHERE organization_id = $1 AND supplier_id = $2 AND id = $3`,
    [context.organizationId, supplier.id, row.id, LEGACY_ADDRESS_TYPE[address.purposes[0]], address.label, address.line1, address.line2, address.locality, address.city,
      address.district, address.state, address.stateCode, address.postalCode, address.countryCode, address.locationEmail, address.locationPhone, registrationId, context.userId ?? null]);
  if (purposesChanged) {
    await writePurposes(client, context, supplier.id, row.id, address.purposes);
    // A location stops being the default for a purpose it no longer serves.
    const defaults = await readDefaults(client, context.organizationId, supplier.id);
    for (const [purpose, column] of Object.entries(ADDRESS_DEFAULT_COLUMNS))
      if (defaults[column] === row.id && !address.purposes.includes(purpose)) await assignDefault(client, context, supplier.id, "address", purpose, null);
  }
  if (Array.isArray(input.defaults)) {
    const defaults = await readDefaults(client, context.organizationId, supplier.id);
    const now = Object.entries(ADDRESS_DEFAULT_COLUMNS).filter(([, column]) => defaults[column] === row.id).map(([purpose]) => purpose);
    const add = input.defaults.filter((purpose) => !now.includes(purpose));
    const remove = now.filter((purpose) => !input.defaults.includes(purpose));
    if (add.length || remove.length) requireSupplierPermission(context, SUPPLIER_PERMISSIONS.defaults, "You do not have permission to set supplier defaults.");
    await applyDefaults(client, context, supplier.id, row.id, address.label, address.purposes, add);
    for (const purpose of remove) await assignDefault(client, context, supplier.id, "address", purpose, null);
  }
  if (changed.length || purposesChanged)
    await recordSupplierEvent(client, context, supplier.id, "supplier.address_changed",
      `Address changed: ${address.label}${purposesChanged ? ` (now ${address.purposes.map(supplierAddressPurposeLabel).join(", ")})` : ""}`,
      { addressId: row.id, changed: [...changed, ...(purposesChanged ? ["purposes"] : [])] });
  if (registrationId !== row.tax_registration_id) {
    const gstin = registrationId ? (await client.query(`SELECT gstin FROM tenant.procurement_supplier_tax_registrations WHERE id = $1`, [registrationId])).rows[0].gstin : null;
    await recordSupplierEvent(client, context, supplier.id, "supplier.address_tax_registration_changed",
      `Tax registration of ${address.label}: ${row.registration_gstin ?? "none"} → ${gstin ?? "none"}`, { addressId: row.id, from: row.registration_gstin, to: gstin });
  }
  return { addressId: row.id, warnings };
}

// Open purchase orders that name this location, for the warning before it is deactivated. They keep their snapshot either way.
async function openDocumentCount(client, organizationId, supplierId, addressId) {
  return Number((await client.query(
    `SELECT count(*) FROM tenant.procurement_purchase_orders WHERE organization_id = $1 AND supplier_id = $2 AND status = ANY($4::text[])
        AND (data #>> '{supplierAddress,addressId}' = $3 OR data #>> '{supplierShipFrom,addressId}' = $3)`,
    [organizationId, supplierId, addressId, OPEN_ORDERS])).rows[0].count);
}

// Deactivated: not offered for new documents, and no longer anyone's default; documents that used it are unchanged.
export async function setSupplierAddressStatus(client, context, supplierId, addressId, active) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.addressesDeactivate, "You do not have permission to deactivate supplier addresses.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = await loadAddress(client, context, supplier, addressId);
  const status = active ? "active" : "inactive";
  const openDocuments = await openDocumentCount(client, context.organizationId, supplier.id, row.id);
  if (row.status === status) return { addressId: row.id, changed: false, openDocuments, clearedDefaults: [] };
  if (active && row.tax_registration_id && row.registration_status !== "active")
    throw new SupplierError(409, `Its GST registration ${row.registration_gstin} is inactive. Reactivate the registration or link another first.`, "SUPPLIER_ADDRESS_REGISTRATION_INACTIVE");
  await client.query(`UPDATE tenant.procurement_supplier_addresses SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, status, context.userId ?? null]);
  const clearedDefaults = active ? [] : await clearDefaultsFor(client, context, supplier.id, "address", row.id);
  await recordSupplierEvent(client, context, supplier.id, active ? "supplier.address_reactivated" : "supplier.address_deactivated",
    `${active ? "Address reactivated" : "Address deactivated"}: ${row.label ?? row.city}${clearedDefaults.length ? ` (no longer the default ${clearedDefaults.map(supplierAddressPurposeLabel).join(", ")} address)` : ""}`,
    { addressId: row.id, openDocuments, clearedDefaults });
  return { addressId: row.id, changed: true, openDocuments, clearedDefaults };
}

// purpose: registered | ordering | billing | ship_from | return_to; addressId: an active location used for it, or null to clear.
export async function setDefaultSupplierAddress(client, context, supplierId, purpose, addressId) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.defaults, "You do not have permission to set supplier defaults.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  if (!addressId) return { changed: await assignDefault(client, context, supplier.id, "address", purpose, null) };
  const row = await loadAddress(client, context, supplier, addressId);
  if (row.status !== "active") throw new SupplierError(409, "An inactive address cannot be a default.", "SUPPLIER_ADDRESS_INACTIVE");
  if (!row.purposes.includes(purpose)) fail("purpose", `${row.label} is not used for ${supplierAddressPurposeLabel(purpose)}. Add that purpose to it first.`);
  return { changed: await assignDefault(client, context, supplier.id, "address", purpose, { id: row.id, name: row.label }) };
}

// filters: purpose, city, stateCode, countryCode, registrationId, status ("active" | "inactive"), search.
export async function listSupplierAddresses(client, context, supplierId, filters = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.addressesView, "You do not have permission to view supplier addresses.");
  const supplier = await loadSupplier(client, context, supplierId);
  const values = [context.organizationId, supplier.id];
  const bind = (value) => `$${values.push(value)}`;
  let where = "address.organization_id = $1 AND address.supplier_id = $2";
  if (PURPOSE_ORDER.includes(filters.purpose))
    where += ` AND EXISTS (SELECT 1 FROM tenant.procurement_supplier_address_purposes p WHERE p.organization_id = address.organization_id AND p.address_id = address.id AND p.purpose = ${bind(filters.purpose)})`;
  if (text(filters.city)) where += ` AND lower(address.city) = lower(${bind(text(filters.city))})`;
  if (/^[0-9]{2}$/.test(filters.stateCode ?? "")) where += ` AND address.state_code = ${bind(filters.stateCode)}`;
  if (/^[A-Z]{2}$/i.test(filters.countryCode ?? "")) where += ` AND address.country_code = ${bind(filters.countryCode.toUpperCase())}`;
  if (isUuid(filters.registrationId)) where += ` AND address.tax_registration_id = ${bind(filters.registrationId)}`;
  if (filters.status === "active" || filters.status === "inactive") where += ` AND address.status = ${bind(filters.status)}`;
  if (text(filters.search)) {
    const term = bind(`%${text(filters.search).replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (address.label ILIKE ${term} OR address.line1 ILIKE ${term} OR address.city ILIKE ${term} OR address.state ILIKE ${term} OR address.postal_code ILIKE ${term}
      OR registration.gstin ILIKE ${term})`;
  }
  const defaults = await readDefaults(client, context.organizationId, supplier.id);
  const { rows } = await client.query(`${ADDRESS_SELECT} WHERE ${where} ORDER BY (address.status = 'active') DESC, address.label, address.created_at`, values);
  return rows.map((row) => toAddress(row, defaults));
}

export const canViewAddresses = (context) => supplierCan(context, SUPPLIER_PERMISSIONS.addressesView);
