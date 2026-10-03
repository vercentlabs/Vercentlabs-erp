// Account addresses: any number per account, each typed (registered,
// billing, shipping, office/branch, other), with at most one default billing
// and one default shipping address. Addresses are shared with Sales: the
// Customer Master uses the same rows, so they never drift apart. Removing an
// address deactivates it, because documents may already print it.
import { CrmError } from "../data-management/errors.js";
import { requireAccountPermission } from "./access.js";
import { ACCOUNT_PERMISSIONS, ADDRESS_TYPES } from "./constants.js";
import { recordAccountHistory } from "./history.js";
import { getAccount, lockAccount } from "./records.js";
import { requireUuid } from "./validation.js";

const TYPES = new Set(ADDRESS_TYPES.map((entry) => entry.code));
const text = (value) => String(value ?? "").trim();
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function toAddress(row) {
  return {
    id: row.id,
    addressType: row.address_type,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    stateCode: row.state_code,
    postalCode: row.postal_code,
    countryCode: row.country_code?.trim() ?? null,
    isDefaultBilling: row.is_default_billing,
    isDefaultShipping: row.is_default_shipping,
    status: row.status,
  };
}

function normalizeAddress(input, current = {}) {
  const pick = (field) => (has(input, field) ? text(input[field]) : text(current[field]));
  const address = {
    addressType: (pick("addressType") || "office").toLowerCase(),
    line1: pick("line1"),
    line2: pick("line2") || null,
    city: pick("city"),
    state: pick("state"),
    stateCode: pick("stateCode") || null,
    postalCode: pick("postalCode"),
    countryCode: pick("countryCode").toUpperCase(),
    isDefaultBilling: has(input, "isDefaultBilling") ? input.isDefaultBilling === true : Boolean(current.isDefaultBilling),
    isDefaultShipping: has(input, "isDefaultShipping") ? input.isDefaultShipping === true : Boolean(current.isDefaultShipping),
  };
  const issues = [];
  if (!TYPES.has(address.addressType)) issues.push({ field: "addressType", message: "Choose an address type." });
  for (const [field, label] of [["line1", "address line 1"], ["city", "city"], ["state", "state"], ["postalCode", "postal code"]])
    if (!address[field]) issues.push({ field, message: `Enter the ${label}.` });
  if (!/^[A-Z]{2}$/.test(address.countryCode)) issues.push({ field: "countryCode", message: "Choose a country." });
  if (address.stateCode && !/^[0-9A-Z]{1,4}$/.test(address.stateCode)) issues.push({ field: "stateCode", message: "Enter a state code such as 27." });
  for (const field of ["line1", "line2", "city", "state", "postalCode"])
    if (text(address[field]).length > 240) issues.push({ field, message: "Must be 240 characters or fewer." });
  if (issues.length) throw new CrmError(400, issues[0].message, "CRM_ACCOUNT_ADDRESS_VALIDATION", { issues });
  return address;
}

// A new default replaces the previous one.
async function clearDefaults(client, context, partyId, address, exceptId = null) {
  if (address.isDefaultBilling)
    await client.query(`UPDATE tenant.addresses SET is_default_billing = false WHERE organization_id = $1 AND party_id = $2 AND is_default_billing AND ($3::uuid IS NULL OR id <> $3)`,
      [context.organizationId, partyId, exceptId]);
  if (address.isDefaultShipping)
    await client.query(`UPDATE tenant.addresses SET is_default_shipping = false WHERE organization_id = $1 AND party_id = $2 AND is_default_shipping AND ($3::uuid IS NULL OR id <> $3)`,
      [context.organizationId, partyId, exceptId]);
}

function describe(address) {
  return `${ADDRESS_TYPES.find((entry) => entry.code === address.addressType)?.label ?? address.addressType} address, ${address.city}`;
}

export async function listAccountAddresses(client, context, partyId, { includeInactive = false } = {}) {
  const account = await getAccount(client, context, partyId);
  const { rows } = await client.query(
    `SELECT * FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND ($3 OR status = 'active')
      ORDER BY status = 'active' DESC, is_default_billing DESC, is_default_shipping DESC, created_at`,
    [context.organizationId, account.id, includeInactive],
  );
  return rows.map(toAddress);
}

export async function addAccountAddress(client, context, partyId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  if (account.status === "archived") throw new CrmError(409, "Reactivate this account before changing it.", "CRM_ACCOUNT_ARCHIVED");
  const address = normalizeAddress(input);
  // The first address of an account becomes its default billing and shipping address.
  const existing = await client.query(`SELECT count(*)::int AS n FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active'`, [context.organizationId, account.id]);
  if (existing.rows[0].n === 0) {
    if (!has(input, "isDefaultBilling")) address.isDefaultBilling = true;
    if (!has(input, "isDefaultShipping")) address.isDefaultShipping = true;
  }
  await clearDefaults(client, context, account.id, address);
  const { rows } = await client.query(
    `INSERT INTO tenant.addresses (organization_id, party_id, address_type, line1, line2, city, state, state_code, postal_code, country_code,
                                   is_default_billing, is_default_shipping, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING *`,
    [context.organizationId, account.id, address.addressType, address.line1, address.line2, address.city, address.state, address.stateCode,
      address.postalCode, address.countryCode, address.isDefaultBilling, address.isDefaultShipping, context.userId ?? null],
  );
  await recordAccountHistory(client, context, account.id, "address_added", `${describe(address)} added`, { addressId: rows[0].id });
  return toAddress(rows[0]);
}

async function lockAddress(client, context, partyId, addressId) {
  const { rows } = await client.query(`SELECT * FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND id = $3 FOR UPDATE`,
    [context.organizationId, partyId, requireUuid(addressId, "Address")]);
  if (!rows[0]) throw new CrmError(404, "Address not found.", "CRM_ACCOUNT_ADDRESS_NOT_FOUND");
  return rows[0];
}

export async function updateAccountAddress(client, context, partyId, addressId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  const current = toAddress(await lockAddress(client, context, account.id, addressId));
  if (current.status !== "active") throw new CrmError(409, "This address has been removed.", "CRM_ACCOUNT_ADDRESS_INACTIVE");
  const address = normalizeAddress(input, current);
  await clearDefaults(client, context, account.id, address, current.id);
  const { rows } = await client.query(
    `UPDATE tenant.addresses SET address_type = $4, line1 = $5, line2 = $6, city = $7, state = $8, state_code = $9, postal_code = $10, country_code = $11,
            is_default_billing = $12, is_default_shipping = $13, updated_by = $14, updated_at = now()
      WHERE organization_id = $1 AND party_id = $2 AND id = $3 RETURNING *`,
    [context.organizationId, account.id, current.id, address.addressType, address.line1, address.line2, address.city, address.state, address.stateCode,
      address.postalCode, address.countryCode, address.isDefaultBilling, address.isDefaultShipping, context.userId ?? null],
  );
  const changes = Object.fromEntries(Object.keys(address).filter((field) => String(address[field] ?? "") !== String(current[field] ?? ""))
    .map((field) => [field, { from: current[field] ?? null, to: address[field] ?? null }]));
  if (Object.keys(changes).length) await recordAccountHistory(client, context, account.id, "address_updated", `${describe(address)} updated`, changes);
  return toAddress(rows[0]);
}

export async function removeAccountAddress(client, context, partyId, addressId) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const account = await lockAccount(client, context, partyId);
  const current = toAddress(await lockAddress(client, context, account.id, addressId));
  if (current.status !== "active") return { changed: false };
  await client.query(
    `UPDATE tenant.addresses SET status = 'inactive', is_default_billing = false, is_default_shipping = false, is_primary = false, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND party_id = $2 AND id = $3`,
    [context.organizationId, account.id, current.id, context.userId ?? null],
  );
  await recordAccountHistory(client, context, account.id, "address_removed", `${describe(current)} removed`, { addressId: current.id });
  return { changed: true };
}
