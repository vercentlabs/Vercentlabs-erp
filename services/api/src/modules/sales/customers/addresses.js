// Customer addresses: any number per customer (headquarters, plants,
// warehouses, branches), each with a type and a label people recognise, with
// exactly one default billing and one default shipping address while the
// customer has an active address. One address can be both.
//
// A location can carry its own GSTIN, so a customer registered in several
// states has one address per registration. Documents copy the address they
// use, so changing or deactivating an address here never changes an issued
// document; an address is never deleted, only deactivated.
import { recordAccountHistory } from "../../crm/accounts/history.js";
import { requireCustomerPermission } from "./access.js";
import { CUSTOMER_ADDRESS_TYPES, CUSTOMER_PERMISSIONS, CustomerError, addressTypeLabel, gstStateCode } from "./constants.js";
import { loadCustomerRow } from "./records.js";
import { GSTIN, has, requireUuid, text } from "./validation.js";

const TYPES = new Set([...CUSTOMER_ADDRESS_TYPES.map((entry) => entry.code), "plant"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO_PERMISSION = "You do not have permission to manage customer addresses.";
const FIELD_LABELS = Object.freeze({
  addressType: "Type", label: "Label", line1: "Address line 1", line2: "Address line 2", city: "City", district: "District", state: "State", stateCode: "State code",
  postalCode: "Postal code", countryCode: "Country", gstin: "GSTIN", contactPerson: "Contact person", phone: "Phone", email: "Email",
  isDefaultBilling: "Default billing", isDefaultShipping: "Default shipping",
});

export function toAddress(row) {
  return {
    id: row.id,
    addressType: row.address_type,
    addressTypeLabel: addressTypeLabel(row.address_type),
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    district: row.district,
    state: row.state,
    stateCode: row.state_code,
    postalCode: row.postal_code,
    countryCode: row.country_code?.trim() ?? null,
    gstin: row.gstin,
    contactPerson: row.contact_person ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    isDefaultBilling: row.is_default_billing,
    isDefaultShipping: row.is_default_shipping,
    isActive: row.status === "active",
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
  };
}

const ADDRESS_SELECT = `
  SELECT address.*, creator.full_name AS created_by_name, updater.full_name AS updated_by_name
    FROM tenant.addresses address
    LEFT JOIN public.users creator ON creator.id = address.created_by
    LEFT JOIN public.users updater ON updater.id = address.updated_by`;

function normalizeAddress(input, current = {}) {
  const pick = (field) => (has(input, field) ? text(input[field]) : text(current[field]));
  const address = {
    addressType: (pick("addressType") || "billing").toLowerCase(),
    label: pick("label") || null,
    line1: pick("line1"),
    line2: pick("line2") || null,
    city: pick("city"),
    district: pick("district") || null,
    state: pick("state"),
    stateCode: pick("stateCode") || null,
    postalCode: pick("postalCode"),
    countryCode: (pick("countryCode") || "IN").toUpperCase(),
    gstin: pick("gstin").toUpperCase() || null,
    contactPerson: pick("contactPerson") || null,
    phone: pick("phone") || null,
    email: pick("email").toLowerCase() || null,
    isDefaultBilling: has(input, "isDefaultBilling") ? input.isDefaultBilling === true : Boolean(current.isDefaultBilling),
    isDefaultShipping: has(input, "isDefaultShipping") ? input.isDefaultShipping === true : Boolean(current.isDefaultShipping),
  };
  const india = address.countryCode === "IN";
  // In India the state code follows from the state name, else the GSTIN.
  if (india && (!address.stateCode || (has(input, "state") && !has(input, "stateCode"))))
    address.stateCode = gstStateCode(address.state) || (address.gstin && GSTIN.test(address.gstin) ? address.gstin.slice(0, 2) : address.stateCode);
  const issues = [];
  if (!TYPES.has(address.addressType)) issues.push({ field: "addressType", message: "Choose an address type." });
  if (!address.line1) issues.push({ field: "line1", message: "Enter the address line 1." });
  if (!address.city) issues.push({ field: "city", message: "Enter the city." });
  if (!/^[A-Z]{2}$/.test(address.countryCode)) issues.push({ field: "countryCode", message: "Choose a country." });
  // A state and a PIN code are part of every Indian address; elsewhere they
  // are entered where the country uses them.
  if (india && !address.state) issues.push({ field: "state", message: "Enter the state." });
  if (india && !address.postalCode) issues.push({ field: "postalCode", message: "Enter the PIN code." });
  if (india && address.postalCode && !/^[1-9][0-9]{5}$/.test(address.postalCode.replace(/\s/g, ""))) issues.push({ field: "postalCode", message: "Enter a 6-digit PIN code." });
  if (address.stateCode && !/^[0-9A-Z]{1,4}$/.test(address.stateCode)) issues.push({ field: "stateCode", message: "Enter a state code such as 27." });
  if (address.gstin && !india) issues.push({ field: "gstin", message: "Only a location in India has a GSTIN." });
  if (address.gstin && india && !GSTIN.test(address.gstin)) issues.push({ field: "gstin", message: "Enter a valid 15-character GSTIN for this location." });
  if (address.gstin && address.stateCode && GSTIN.test(address.gstin) && address.gstin.slice(0, 2) !== address.stateCode)
    issues.push({ field: "gstin", message: `This GSTIN is registered in state ${address.gstin.slice(0, 2)}, but the address is in state ${address.stateCode}.` });
  if (address.email && !EMAIL.test(address.email)) issues.push({ field: "email", message: "Enter a valid email address." });
  if (address.phone) {
    const digits = address.phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) issues.push({ field: "phone", message: "Enter a phone number with 7 to 15 digits." });
  }
  for (const field of ["label", "line1", "line2", "city", "district", "state", "postalCode", "contactPerson", "email"])
    if (text(address[field]).length > 240) issues.push({ field, message: "Must be 240 characters or fewer." });
  if (issues.length) throw new CustomerError(400, issues[0].message, "SALES_CUSTOMER_ADDRESS_VALIDATION", { issues });
  // The database requires a state and postal code; a country without them stores a dash.
  if (!address.state) address.state = "-";
  if (!address.postalCode) address.postalCode = "-";
  return address;
}

const describe = (address) => address.label || `${addressTypeLabel(address.addressType)} address, ${address.city}`;

// Addresses of this customer that are obviously the same place: the same
// first line, city and postal code, ignoring case, spaces and punctuation.
export async function findDuplicateCustomerAddress(client, context, partyId, address, exceptId = null) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.addresses
      WHERE organization_id = $1 AND party_id = $2 AND ($3::uuid IS NULL OR id <> $3)
        AND regexp_replace(lower(line1), '[^a-z0-9]', '', 'g') = regexp_replace(lower($4), '[^a-z0-9]', '', 'g')
        AND regexp_replace(lower(city), '[^a-z0-9]', '', 'g') = regexp_replace(lower($5), '[^a-z0-9]', '', 'g')
        AND regexp_replace(lower(postal_code), '[^a-z0-9]', '', 'g') = regexp_replace(lower($6), '[^a-z0-9]', '', 'g')
      ORDER BY status = 'active' DESC, created_at LIMIT 5`,
    [context.organizationId, partyId, exceptId, text(address.line1), text(address.city), text(address.postalCode)],
  );
  return rows.map(toAddress);
}

// A duplicate is a warning: the caller may save anyway.
async function warnOnDuplicate(client, context, partyId, address, input, exceptId = null) {
  if (input.allowDuplicate === true) return;
  const duplicates = await findDuplicateCustomerAddress(client, context, partyId, address, exceptId);
  if (duplicates.length)
    throw new CustomerError(409, `This customer already has this address${duplicates[0].label ? ` as “${duplicates[0].label}”` : ""}${duplicates[0].isActive ? "" : " (inactive)"}.`,
      "SALES_CUSTOMER_ADDRESS_DUPLICATE", { duplicateAddress: true, duplicates });
}

// A new default replaces the previous one.
async function clearDefaults(client, context, partyId, address, exceptId = null) {
  for (const [flag, column] of [["isDefaultBilling", "is_default_billing"], ["isDefaultShipping", "is_default_shipping"]])
    if (address[flag])
      await client.query(`UPDATE tenant.addresses SET ${column} = false WHERE organization_id = $1 AND party_id = $2 AND ${column} AND ($3::uuid IS NULL OR id <> $3)`,
        [context.organizationId, partyId, exceptId]);
}

// While the customer has an active address, one is the default billing and
// one the default shipping address.
async function ensureDefaults(client, context, partyId) {
  for (const column of ["is_default_billing", "is_default_shipping"])
    await client.query(
      `UPDATE tenant.addresses SET ${column} = true
        WHERE id = (SELECT id FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active'
                     ORDER BY (address_type = $3) DESC, created_at LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND ${column})`,
      [context.organizationId, partyId, column === "is_default_billing" ? "billing" : "shipping"],
    );
}

// Inserts an address without permission or visibility checks; the caller has
// made them.
export async function insertAddress(client, context, partyId, input) {
  const address = normalizeAddress(input);
  await clearDefaults(client, context, partyId, address);
  const { rows } = await client.query(
    `INSERT INTO tenant.addresses (organization_id, party_id, address_type, label, line1, line2, city, district, state, state_code, postal_code, country_code, gstin,
                                   contact_person, phone, email, is_default_billing, is_default_shipping, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19) RETURNING *`,
    [context.organizationId, partyId, address.addressType, address.label, address.line1, address.line2, address.city, address.district, address.state, address.stateCode,
      address.postalCode, address.countryCode, address.gstin, address.contactPerson, address.phone, address.email, address.isDefaultBilling, address.isDefaultShipping,
      context.userId ?? null],
  );
  await ensureDefaults(client, context, partyId);
  await recordAccountHistory(client, context, partyId, "address_added", `Address added: ${describe(address)}`, { addressId: rows[0].id, kind: "address_added" });
  return rows[0].id;
}

// filters: includeInactive (default true), search (label, city, state,
// postal code).
export async function listCustomerAddresses(client, context, customerId, { includeInactive = true, search = "" } = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.viewAddresses, "You do not have permission to view customer addresses.");
  const customer = await loadCustomerRow(client, context, customerId);
  const { rows } = await client.query(
    `${ADDRESS_SELECT} WHERE address.organization_id = $1 AND address.party_id = $2 AND ($3 OR address.status = 'active')
        AND lower(concat_ws(' ', address.label, address.line1, address.city, address.district, address.state, address.postal_code)) LIKE $4
      ORDER BY address.status = 'active' DESC, address.is_default_billing DESC, address.is_default_shipping DESC, lower(COALESCE(address.label, address.city)), address.created_at`,
    [context.organizationId, customer.id, includeInactive, `%${text(search).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`],
  );
  return rows.map(toAddress);
}

async function lockAddress(client, context, partyId, addressId) {
  const { rows } = await client.query(`SELECT * FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND id = $3 FOR UPDATE`,
    [context.organizationId, partyId, requireUuid(addressId, "Address")]);
  if (!rows[0]) throw new CustomerError(404, "Address not found.", "SALES_CUSTOMER_ADDRESS_NOT_FOUND");
  return rows[0];
}

const reload = async (client, context, partyId, addressId) =>
  toAddress((await client.query(`${ADDRESS_SELECT} WHERE address.organization_id = $1 AND address.party_id = $2 AND address.id = $3`, [context.organizationId, partyId, addressId])).rows[0]);

// input: the address fields, and allowDuplicate to save an address the
// customer already has.
export async function addCustomerAddress(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.manageAddresses, NO_PERMISSION);
  const customer = await loadCustomerRow(client, context, customerId, { lock: true });
  await warnOnDuplicate(client, context, customer.id, normalizeAddress(input), input);
  return reload(client, context, customer.id, await insertAddress(client, context, customer.id, input));
}

export async function updateCustomerAddress(client, context, customerId, addressId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.manageAddresses, NO_PERMISSION);
  const customer = await loadCustomerRow(client, context, customerId, { lock: true });
  const current = toAddress(await lockAddress(client, context, customer.id, addressId));
  if (!current.isActive) throw new CustomerError(409, "Reactivate this address before changing it.", "SALES_CUSTOMER_ADDRESS_INACTIVE");
  const address = normalizeAddress(input, current);
  const changedFields = Object.keys(FIELD_LABELS).filter((field) => String(address[field] ?? "") !== String(current[field] ?? ""));
  // The GSTIN and the tax state decide the tax on every document.
  if (changedFields.some((field) => ["gstin", "stateCode"].includes(field)) && !(changedFields.includes("stateCode") && !changedFields.includes("gstin") && !current.gstin && !current.stateCode))
    requireCustomerPermission(context, CUSTOMER_PERMISSIONS.editAddressGstin, "You do not have permission to change the GSTIN or tax state of an address.");
  // A default can be moved to another address, not switched off.
  for (const [flag, label, permission] of [["isDefaultBilling", "billing", CUSTOMER_PERMISSIONS.setDefaultBilling], ["isDefaultShipping", "shipping", CUSTOMER_PERMISSIONS.setDefaultShipping]]) {
    if (current[flag] && !address[flag]) throw new CustomerError(409, `Choose another default ${label} address instead of clearing this one.`, "SALES_CUSTOMER_ADDRESS_DEFAULT_REQUIRED");
    if (!current[flag] && address[flag]) requireCustomerPermission(context, permission, `You do not have permission to change the default ${label} address.`);
  }
  if (changedFields.some((field) => ["line1", "city", "postalCode"].includes(field))) await warnOnDuplicate(client, context, customer.id, address, input, current.id);
  if (!changedFields.length) return reload(client, context, customer.id, current.id);
  await clearDefaults(client, context, customer.id, address, current.id);
  await client.query(
    `UPDATE tenant.addresses SET address_type = $4, label = $5, line1 = $6, line2 = $7, city = $8, district = $9, state = $10, state_code = $11, postal_code = $12,
            country_code = $13, gstin = $14, contact_person = $15, phone = $16, email = $17, is_default_billing = $18, is_default_shipping = $19, updated_by = $20, updated_at = now()
      WHERE organization_id = $1 AND party_id = $2 AND id = $3`,
    [context.organizationId, customer.id, current.id, address.addressType, address.label, address.line1, address.line2, address.city, address.district, address.state,
      address.stateCode, address.postalCode, address.countryCode, address.gstin, address.contactPerson, address.phone, address.email, address.isDefaultBilling,
      address.isDefaultShipping, context.userId ?? null],
  );
  const changes = Object.fromEntries(changedFields.map((field) => [field, { label: FIELD_LABELS[field], from: current[field] ?? null, to: address[field] ?? null }]));
  // A GSTIN change is recorded as its own event so it is never lost among other edits.
  if (changes.gstin)
    await recordAccountHistory(client, context, customer.id, "address_updated", `GSTIN changed on ${describe(address)}: ${current.gstin ?? "none"} → ${address.gstin ?? "none"}`,
      { addressId: current.id, kind: "gstin_changed", gstin: changes.gstin });
  for (const [flag, label] of [["isDefaultBilling", "billing"], ["isDefaultShipping", "shipping"]])
    if (changes[flag]) await recordAccountHistory(client, context, customer.id, "address_updated", `Default ${label} address: ${describe(address)}`, { addressId: current.id, kind: `default_${label}_changed` });
  const { gstin: _gstin, isDefaultBilling: _billing, isDefaultShipping: _shipping, ...rest } = changes;
  if (Object.keys(rest).length) await recordAccountHistory(client, context, customer.id, "address_updated", `Address changed: ${describe(address)}`, { addressId: current.id, kind: "address_changed", ...rest });
  return reload(client, context, customer.id, current.id);
}

async function setDefault(client, context, customerId, addressId, column, label, permission) {
  requireCustomerPermission(context, permission, `You do not have permission to change the default ${label} address.`);
  const customer = await loadCustomerRow(client, context, customerId, { lock: true });
  const current = await lockAddress(client, context, customer.id, addressId);
  if (current.status !== "active") throw new CustomerError(409, "An inactive address cannot be a default.", "SALES_CUSTOMER_ADDRESS_INACTIVE");
  if (current[column]) return reload(client, context, customer.id, current.id);
  // Both changes happen in the caller's transaction, so there is never a
  // moment with two defaults or none.
  await client.query(`UPDATE tenant.addresses SET ${column} = false WHERE organization_id = $1 AND party_id = $2 AND ${column}`, [context.organizationId, customer.id]);
  await client.query(`UPDATE tenant.addresses SET ${column} = true, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, context.userId ?? null]);
  await recordAccountHistory(client, context, customer.id, "address_updated", `Default ${label} address: ${describe(toAddress(current))}`, { addressId: current.id, kind: `default_${label}_changed` });
  return reload(client, context, customer.id, current.id);
}

export const setDefaultBillingAddress = (client, context, customerId, addressId) =>
  setDefault(client, context, customerId, addressId, "is_default_billing", "billing", CUSTOMER_PERMISSIONS.setDefaultBilling);
export const setDefaultShippingAddress = (client, context, customerId, addressId) =>
  setDefault(client, context, customerId, addressId, "is_default_shipping", "shipping", CUSTOMER_PERMISSIONS.setDefaultShipping);

// active false deactivates the address (its defaults move to another active
// address); active true brings it back. Documents that used it keep their
// own copy.
export async function setCustomerAddressActive(client, context, customerId, addressId, active) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.inactivateAddress, "You do not have permission to deactivate customer addresses.");
  const customer = await loadCustomerRow(client, context, customerId, { lock: true });
  const current = toAddress(await lockAddress(client, context, customer.id, addressId));
  if (current.isActive === Boolean(active)) return reload(client, context, customer.id, current.id);
  await client.query(
    `UPDATE tenant.addresses SET status = $4, is_default_billing = false, is_default_shipping = false, is_primary = false, updated_by = $5, updated_at = now()
      WHERE organization_id = $1 AND party_id = $2 AND id = $3`,
    [context.organizationId, customer.id, current.id, active ? "active" : "inactive", context.userId ?? null],
  );
  await ensureDefaults(client, context, customer.id);
  await recordAccountHistory(client, context, customer.id, active ? "address_added" : "address_removed", `Address ${active ? "reactivated" : "inactivated"}: ${describe(current)}`,
    { addressId: current.id, kind: active ? "address_reactivated" : "address_inactivated" });
  return reload(client, context, customer.id, current.id);
}

export const deactivateCustomerAddress = (client, context, customerId, addressId) => setCustomerAddressActive(client, context, customerId, addressId, false);

