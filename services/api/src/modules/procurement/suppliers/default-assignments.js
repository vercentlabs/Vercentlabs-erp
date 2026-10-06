// The supplier's defaults: one location per address purpose (registered,
// ordering, billing, ship-from, return-to) and one person per contact
// purpose (primary, RFQ, ordering, accounts, dispatch). One row per
// supplier holds them all, so a purpose can never have two defaults. A
// default is only a starting value for new documents; a document may use
// another active location or person. A deactivated location or person stops
// being anyone's default.
import { SUPPLIER_ADDRESS_PURPOSES, SUPPLIER_CONTACT_PURPOSES, SupplierError, supplierAddressPurposeLabel, supplierContactPurposeLabel } from "./constants.js";
import { recordSupplierEvent } from "./access.js";

export const ADDRESS_DEFAULT_COLUMNS = Object.freeze(Object.fromEntries(SUPPLIER_ADDRESS_PURPOSES.filter((entry) => entry.defaultColumn).map((entry) => [entry.code, entry.defaultColumn])));
export const CONTACT_DEFAULT_COLUMNS = Object.freeze(Object.fromEntries(SUPPLIER_CONTACT_PURPOSES.map((entry) => [entry.code, entry.defaultColumn])));

const EMPTY = Object.freeze({
  registered_address_id: null, ordering_address_id: null, billing_address_id: null, ship_from_address_id: null, return_to_address_id: null,
  primary_contact_id: null, rfq_contact_id: null, ordering_contact_id: null, accounts_contact_id: null, dispatch_contact_id: null,
});

export async function readDefaults(client, organizationId, supplierId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.procurement_supplier_defaults WHERE organization_id = $1 AND supplier_id = $2${lock ? " FOR UPDATE" : ""}`,
    [organizationId, supplierId])).rows[0];
  return { ...EMPTY, ...(row ?? {}) };
}

// The defaults as the screens read them: { addresses: { ordering: id, ... }, contacts: { primary: id, ... } }.
export function defaultsView(row) {
  return {
    addresses: Object.fromEntries(Object.entries(ADDRESS_DEFAULT_COLUMNS).map(([purpose, column]) => [purpose, row[column] ?? null])),
    contacts: Object.fromEntries(Object.entries(CONTACT_DEFAULT_COLUMNS).map(([purpose, column]) => [purpose, row[column] ?? null])),
  };
}

async function write(client, context, supplierId, column, value) {
  await client.query(
    `INSERT INTO tenant.procurement_supplier_defaults (organization_id, supplier_id, ${column}, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, supplier_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, supplierId, value, context.userId ?? null]);
}

// kind: "address" | "contact"; target: the location / contact relationship (with a name for the history), or null to clear.
export async function assignDefault(client, context, supplierId, kind, purpose, target, { record = true } = {}) {
  const columns = kind === "address" ? ADDRESS_DEFAULT_COLUMNS : CONTACT_DEFAULT_COLUMNS;
  const column = columns[purpose];
  if (!column) throw new SupplierError(400, `There is no default ${kind === "address" ? "address" : "contact"} for that purpose.`, "SUPPLIER_DEFAULT_PURPOSE", { issues: [{ field: "purpose", message: "Choose the purpose." }] });
  const current = await readDefaults(client, context.organizationId, supplierId, { lock: true });
  if ((current[column] ?? null) === (target?.id ?? null)) return false;
  await write(client, context, supplierId, column, target?.id ?? null);
  if (record) {
    const label = kind === "address" ? supplierAddressPurposeLabel(purpose) : supplierContactPurposeLabel(purpose);
    const eventType = kind === "address" ? `supplier.default_${purpose}_address_changed` : purpose === "primary" ? "supplier.primary_contact_changed" : `supplier.default_${purpose}_contact_changed`;
    const summary = kind === "address" ? `Default ${label} address: ${target?.name ?? "none"}` : `${purpose === "primary" ? "Primary contact" : `Default ${label.replace(" contact", "")} contact`}: ${target?.name ?? "none"}`;
    await recordSupplierEvent(client, context, supplierId, eventType, summary, { purpose, [kind === "address" ? "addressId" : "contactRelationshipId"]: target?.id ?? null });
  }
  return true;
}

// A deactivated location or person stops being a default. Returns the purposes it was the default for.
export async function clearDefaultsFor(client, context, supplierId, kind, id) {
  const columns = kind === "address" ? ADDRESS_DEFAULT_COLUMNS : CONTACT_DEFAULT_COLUMNS;
  const current = await readDefaults(client, context.organizationId, supplierId, { lock: true });
  const cleared = Object.entries(columns).filter(([, column]) => current[column] === id).map(([purpose]) => purpose);
  for (const purpose of cleared) await write(client, context, supplierId, columns[purpose], null);
  return cleared;
}
