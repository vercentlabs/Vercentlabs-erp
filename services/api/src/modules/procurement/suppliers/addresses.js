// A supplier's locations: registered office, billing and ordering offices,
// the places goods ship from, branches. Each may carry its own GST
// registration, so a supplier with plants in several states keeps one
// identity and several GSTINs. A document chooses a location and keeps a
// snapshot of it, so changing an address never changes an old document.
import {
  GSTIN_PATTERN, GST_REGISTRATION_TYPES, SUPPLIER_ADDRESS_TYPES, SUPPLIER_PERMISSIONS, SupplierError, has, requireUuid, supplierAddressTypeLabel, text,
} from "./constants.js";
import { loadSupplier, recordSupplierEvent, requireSupplierPermission } from "./access.js";

function fail(field, message) {
  throw new SupplierError(400, message, "SUPPLIER_ADDRESS_VALIDATION", { issues: [{ field, message }] });
}

function normalizeAddress(input = {}, current = {}) {
  const pick = (field, max = 200) => (has(input, field) ? text(input[field], max) : current[field] ?? null);
  const address = {
    addressType: pick("addressType", 20), label: pick("label", 120), line1: pick("line1", 300), line2: pick("line2", 300), city: pick("city", 120), district: pick("district", 120),
    state: pick("state", 120), stateCode: pick("stateCode", 2), postalCode: pick("postalCode", 20), countryCode: (pick("countryCode", 2) ?? "IN").toUpperCase(),
    gstRegistrationType: pick("gstRegistrationType", 40), gstin: pick("gstin", 15)?.toUpperCase().replace(/\s+/g, "") ?? null,
  };
  if (!SUPPLIER_ADDRESS_TYPES.some((entry) => entry.code === address.addressType)) fail("addressType", "Choose the address type.");
  if (!address.line1) fail("line1", "Enter the address.");
  if (!address.city) fail("city", "Enter the city.");
  if (!/^[A-Z]{2}$/.test(address.countryCode)) fail("countryCode", "Choose the country.");
  if (address.gstin && !GSTIN_PATTERN.test(address.gstin)) fail("gstin", "A GSTIN has 15 characters: the state code, the PAN and three more.");
  if (address.gstin) {
    if (address.stateCode && address.stateCode !== address.gstin.slice(0, 2)) fail("stateCode", "The state must be the GSTIN's state.");
    address.stateCode ??= address.gstin.slice(0, 2);
    address.gstRegistrationType ??= "registered_regular";
  }
  if (address.stateCode && !/^[0-9]{2}$/.test(address.stateCode)) fail("stateCode", "Choose the state.");
  if (address.gstRegistrationType && !GST_REGISTRATION_TYPES.some((entry) => entry.code === address.gstRegistrationType)) fail("gstRegistrationType", "Choose the GST registration type.");
  if (GST_REGISTRATION_TYPES.find((entry) => entry.code === address.gstRegistrationType)?.needsGstin && !address.gstin) fail("gstin", "A registered location needs its GSTIN.");
  return address;
}

// A GSTIN identifies one legal entity: it may be on this supplier's party and locations, never on another company.
async function assertGstinOwn(client, context, supplier, gstin, exceptAddressId = null) {
  if (!gstin) return;
  const other = (await client.query(
    `SELECT COALESCE(supplier.supplier_number, party.customer_number, party.code) AS number, party.display_name FROM tenant.business_parties party
       LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = party.organization_id AND supplier.party_id = party.id
      WHERE party.organization_id = $1 AND party.id <> $2 AND (upper(party.gstin) = $3 OR EXISTS (
        SELECT 1 FROM tenant.procurement_supplier_addresses address WHERE address.organization_id = party.organization_id AND address.supplier_id = supplier.id
           AND address.gstin = $3 AND address.status = 'active' AND ($4::uuid IS NULL OR address.id <> $4::uuid)))
      LIMIT 1`, [context.organizationId, supplier.party_id, gstin, exceptAddressId])).rows[0];
  if (other) throw new SupplierError(409, `GSTIN ${gstin} already belongs to ${other.number} ${other.display_name}.`, "SUPPLIER_GSTIN_TAKEN", { issues: [{ field: "gstin", message: `Already belongs to ${other.number}.` }] });
}

const describe = (address) => `${supplierAddressTypeLabel(address.addressType)}${address.label ? ` (${address.label})` : ""}, ${address.city}`;

// Used by createSupplier (record: false: the creation event already says it) and by Add Address.
export async function insertSupplierAddress(client, context, supplierId, input = {}, { record = true } = {}) {
  const supplier = (await client.query(`SELECT id, party_id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplierId])).rows[0];
  if (!supplier) throw new SupplierError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  const address = normalizeAddress(input);
  await assertGstinOwn(client, context, supplier, address.gstin);
  const hasPrimary = (await client.query(`SELECT 1 FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND is_primary`,
    [context.organizationId, supplier.id])).rows[0];
  const primary = input.isPrimary === true || !hasPrimary;
  if (primary) await client.query(`UPDATE tenant.procurement_supplier_addresses SET is_primary = false, updated_at = now() WHERE organization_id = $1 AND supplier_id = $2 AND is_primary`,
    [context.organizationId, supplier.id]);
  const { rows } = await client.query(
    `INSERT INTO tenant.procurement_supplier_addresses (organization_id, supplier_id, address_type, label, line1, line2, city, district, state, state_code, postal_code, country_code,
       gst_registration_type, gstin, is_primary, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) RETURNING id`,
    [context.organizationId, supplier.id, address.addressType, address.label, address.line1, address.line2, address.city, address.district, address.state, address.stateCode,
      address.postalCode, address.countryCode, address.gstRegistrationType, address.gstin, primary, context.userId ?? null]);
  if (record) await recordSupplierEvent(client, context, supplier.id, "supplier.address_added", `Address added: ${describe(address)}${address.gstin ? ` · GSTIN ${address.gstin}` : ""}`,
    { addressId: rows[0].id, gstin: address.gstin });
  return rows[0].id;
}

export async function addSupplierAddress(client, context, supplierId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.addresses, "You do not have permission to manage supplier addresses.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const id = await insertSupplierAddress(client, context, supplier.id, input);
  return { addressId: id };
}

async function loadAddress(client, context, supplier, addressId) {
  const row = (await client.query(`SELECT * FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND id = $3 FOR UPDATE`,
    [context.organizationId, supplier.id, requireUuid(addressId, "Address")])).rows[0];
  if (!row) throw new SupplierError(404, "Address not found.", "SUPPLIER_ADDRESS_NOT_FOUND");
  return row;
}

const fromRow = (row) => ({
  addressType: row.address_type, label: row.label, line1: row.line1, line2: row.line2, city: row.city, district: row.district, state: row.state, stateCode: row.state_code,
  postalCode: row.postal_code, countryCode: row.country_code?.trim(), gstRegistrationType: row.gst_registration_type, gstin: row.gstin,
});

// input: any address fields; isPrimary: true makes it the supplier's default location.
export async function updateSupplierAddress(client, context, supplierId, addressId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.addresses, "You do not have permission to manage supplier addresses.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = await loadAddress(client, context, supplier, addressId);
  if (row.status !== "active") throw new SupplierError(409, "Reactivate this address before changing it.", "SUPPLIER_ADDRESS_INACTIVE");
  const before = fromRow(row);
  const address = normalizeAddress(input, before);
  if (address.gstin !== before.gstin) await assertGstinOwn(client, context, supplier, address.gstin, row.id);
  if (input.isPrimary === true && !row.is_primary)
    await client.query(`UPDATE tenant.procurement_supplier_addresses SET is_primary = false, updated_at = now() WHERE organization_id = $1 AND supplier_id = $2 AND is_primary`,
      [context.organizationId, supplier.id]);
  await client.query(
    `UPDATE tenant.procurement_supplier_addresses SET address_type = $4, label = $5, line1 = $6, line2 = $7, city = $8, district = $9, state = $10, state_code = $11, postal_code = $12,
            country_code = $13, gst_registration_type = $14, gstin = $15, is_primary = (is_primary OR $16), updated_by = $17, updated_at = now()
      WHERE organization_id = $1 AND supplier_id = $2 AND id = $3`,
    [context.organizationId, supplier.id, row.id, address.addressType, address.label, address.line1, address.line2, address.city, address.district, address.state, address.stateCode,
      address.postalCode, address.countryCode, address.gstRegistrationType, address.gstin, input.isPrimary === true, context.userId ?? null]);
  const changed = Object.keys(address).filter((field) => (address[field] ?? null) !== (before[field] ?? null));
  if (changed.length || (input.isPrimary === true && !row.is_primary))
    await recordSupplierEvent(client, context, supplier.id, "supplier.address_changed",
      `Address changed: ${describe(address)}${input.isPrimary === true && !row.is_primary ? " (now the default)" : ""}${changed.includes("gstin") ? ` · GSTIN ${before.gstin ?? "none"} → ${address.gstin ?? "none"}` : ""}`,
      { addressId: row.id, changed });
  return { addressId: row.id };
}

// An address documents used stays readable on them; here it only stops being offered. The default cannot be removed without another.
export async function setSupplierAddressStatus(client, context, supplierId, addressId, active) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.addresses, "You do not have permission to manage supplier addresses.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = await loadAddress(client, context, supplier, addressId);
  const status = active ? "active" : "inactive";
  if (row.status === status) return { addressId: row.id, changed: false };
  if (!active && row.is_primary) {
    const next = (await client.query(
      `SELECT id FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND id <> $3 AND status = 'active'
        ORDER BY (address_type = 'registered') DESC, created_at LIMIT 1`, [context.organizationId, supplier.id, row.id])).rows[0];
    await client.query(`UPDATE tenant.procurement_supplier_addresses SET is_primary = false WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
    if (next) await client.query(`UPDATE tenant.procurement_supplier_addresses SET is_primary = true WHERE organization_id = $1 AND id = $2`, [context.organizationId, next.id]);
  }
  if (active && row.gstin) await assertGstinOwn(client, context, supplier, row.gstin, row.id);
  await client.query(`UPDATE tenant.procurement_supplier_addresses SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, status, context.userId ?? null]);
  await recordSupplierEvent(client, context, supplier.id, active ? "supplier.address_reactivated" : "supplier.address_removed",
    `${active ? "Address reactivated" : "Address removed"}: ${describe(fromRow(row))}`, { addressId: row.id });
  return { addressId: row.id, changed: true };
}
