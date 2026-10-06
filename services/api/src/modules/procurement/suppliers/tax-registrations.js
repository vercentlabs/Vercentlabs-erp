// A supplier's GST registrations. Each is a record of its own (GSTIN, type,
// state); a location links to the registration it trades under, one
// registration may cover several places of business, and a supplier may hold
// several (one per state). The GSTIN on the supplier itself is its principal
// registration. A GSTIN belongs to one supplier in the tenant, and never to
// another company (a customer or account) at the same time. Documents keep a
// snapshot of the registration they used.
import { GSTIN_PATTERN, GST_REGISTRATION_TYPES, SUPPLIER_PERMISSIONS, SupplierError, has, requireUuid, text } from "./constants.js";
import { loadSupplier, recordSupplierEvent, requireSupplierPermission } from "./access.js";
import { gstStateName } from "../../../core/tax/index.js";

const REGISTERED = new Set(["registered_regular", "registered_composition", "sez", "deemed_export"]);

export const toRegistration = (row) => row && ({
  id: row.id, gstin: row.gstin, registrationType: row.registration_type,
  registrationLabel: GST_REGISTRATION_TYPES.find((entry) => entry.code === row.registration_type)?.label ?? row.registration_type,
  stateCode: row.state_code, stateName: gstStateName(row.state_code), isPrincipal: row.is_principal, status: row.status,
});

function fail(field, message, code = "SUPPLIER_TAX_REGISTRATION_VALIDATION") {
  throw new SupplierError(400, message, code, { issues: [{ field, message }] });
}

export function normalizeGstin(value) {
  const gstin = text(value, 20)?.toUpperCase().replace(/\s+/g, "") ?? null;
  if (gstin && !GSTIN_PATTERN.test(gstin)) fail("gstin", "A GSTIN has 15 characters: the state code, the PAN and three more.");
  return gstin;
}

export async function listSupplierTaxRegistrations(client, organizationId, supplierId) {
  return (await client.query(
    `SELECT * FROM tenant.procurement_supplier_tax_registrations WHERE organization_id = $1 AND supplier_id = $2 ORDER BY is_principal DESC, (status = 'active') DESC, gstin`,
    [organizationId, supplierId])).rows.map(toRegistration);
}

// The registration for a GSTIN on this supplier: the existing one, or a new one. Refused when another company holds the GSTIN.
export async function ensureRegistration(client, context, supplier, gstin, { registrationType = "registered_regular", principal = false } = {}) {
  const type = REGISTERED.has(registrationType) ? registrationType : "registered_regular";
  const holder = (await client.query(
    `SELECT registration.id, registration.supplier_id, registration.status, other.supplier_number, party.display_name
       FROM tenant.procurement_supplier_tax_registrations registration
       JOIN tenant.procurement_suppliers other ON other.organization_id = registration.organization_id AND other.id = registration.supplier_id
       JOIN tenant.business_parties party ON party.organization_id = other.organization_id AND party.id = other.party_id
      WHERE registration.organization_id = $1 AND registration.gstin = $2`, [context.organizationId, gstin])).rows[0];
  if (holder && holder.supplier_id !== supplier.id)
    throw new SupplierError(409, `GSTIN ${gstin} already belongs to ${holder.supplier_number} ${holder.display_name}.`, "SUPPLIER_GSTIN_TAKEN",
      { issues: [{ field: "gstin", message: `Already belongs to ${holder.supplier_number}.` }] });
  const company = (await client.query(
    `SELECT COALESCE(customer_number, code) AS number, display_name FROM tenant.business_parties WHERE organization_id = $1 AND id <> $2 AND upper(gstin) = $3 LIMIT 1`,
    [context.organizationId, supplier.party_id, gstin])).rows[0];
  if (company) throw new SupplierError(409, `GSTIN ${gstin} belongs to ${company.number} ${company.display_name}.`, "SUPPLIER_GSTIN_TAKEN",
    { issues: [{ field: "gstin", message: `Belongs to ${company.display_name}.` }] });
  if (principal)
    await client.query(`UPDATE tenant.procurement_supplier_tax_registrations SET is_principal = false, updated_at = now() WHERE organization_id = $1 AND supplier_id = $2 AND is_principal AND gstin <> $3`,
      [context.organizationId, supplier.id, gstin]);
  if (holder) {
    await client.query(
      `UPDATE tenant.procurement_supplier_tax_registrations SET status = 'active', is_principal = is_principal OR $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, holder.id, principal, context.userId ?? null]);
    return { id: holder.id, created: false };
  }
  const id = (await client.query(
    `INSERT INTO tenant.procurement_supplier_tax_registrations (organization_id, supplier_id, gstin, registration_type, state_code, is_principal, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [context.organizationId, supplier.id, gstin, type, gstin.slice(0, 2), principal, context.userId ?? null])).rows[0].id;
  return { id, created: true };
}

// input: gstin, registrationType.
export async function addSupplierTaxRegistration(client, context, supplierId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.tax, "You do not have permission to manage supplier tax registrations.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const gstin = normalizeGstin(input.gstin);
  if (!gstin) fail("gstin", "Enter the GSTIN.");
  const type = text(input.registrationType, 40) ?? "registered_regular";
  if (!REGISTERED.has(type)) fail("registrationType", "Choose the registration type.");
  const result = await ensureRegistration(client, context, supplier, gstin, { registrationType: type });
  if (result.created)
    await recordSupplierEvent(client, context, supplier.id, "supplier.tax_registration_added", `GST registration added: ${gstin} (${gstStateName(gstin.slice(0, 2)) ?? gstin.slice(0, 2)})`,
      { registrationId: result.id, gstin });
  return { registrationId: result.id, created: result.created };
}

// input: registrationType, status ("active" | "inactive"). The principal registration changes with the supplier's own GSTIN.
export async function updateSupplierTaxRegistration(client, context, supplierId, registrationId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.tax, "You do not have permission to manage supplier tax registrations.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const row = (await client.query(`SELECT * FROM tenant.procurement_supplier_tax_registrations WHERE organization_id = $1 AND supplier_id = $2 AND id = $3 FOR UPDATE`,
    [context.organizationId, supplier.id, requireUuid(registrationId, "Registration")])).rows[0];
  if (!row) throw new SupplierError(404, "Registration not found.", "SUPPLIER_TAX_REGISTRATION_NOT_FOUND");
  const type = has(input, "registrationType") ? text(input.registrationType, 40) : row.registration_type;
  if (!REGISTERED.has(type)) fail("registrationType", "Choose the registration type.");
  const status = has(input, "status") ? (input.status === "inactive" ? "inactive" : "active") : row.status;
  if (status === "inactive" && row.is_principal)
    throw new SupplierError(409, "This is the supplier's own GSTIN. Change the GSTIN on the supplier instead.", "SUPPLIER_TAX_REGISTRATION_PRINCIPAL");
  if (status === row.status && type === row.registration_type) return { registrationId: row.id, changed: false };
  await client.query(`UPDATE tenant.procurement_supplier_tax_registrations SET registration_type = $3, status = $4, updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, type, status, context.userId ?? null]);
  const linked = Number((await client.query(`SELECT count(*) FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND tax_registration_id = $2 AND status = 'active'`,
    [context.organizationId, row.id])).rows[0].count);
  await recordSupplierEvent(client, context, supplier.id, "supplier.tax_registration_changed",
    `GST registration ${row.gstin}: ${status !== row.status ? (status === "inactive" ? "deactivated" : "reactivated") : `type ${row.registration_type} → ${type}`}`,
    { registrationId: row.id, from: { status: row.status, type: row.registration_type }, to: { status, type } });
  return { registrationId: row.id, changed: true, linkedLocations: linked };
}
