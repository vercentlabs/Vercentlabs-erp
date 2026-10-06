// What a new purchase document takes from its supplier, once.
//
// The supplier's currency, payment terms, ordering contact, ordering location
// and tax identity are resolved when the document is started and copied onto
// it as a snapshot. From then on the document owns them: changing the
// supplier's terms, GSTIN or address later never changes an existing order.
//
// Only an active supplier starts new business. This is checked here, on the
// server, whatever a screen offered: an inactive or blocked supplier is
// refused for a new purchase order however the request was made.
import { purchaseTermSnapshot } from "../../../core/payment-terms/index.js";
import { gstStateName } from "../../../core/tax/index.js";
import { SUPPLIER_STATUS, SupplierError, isUuid } from "./constants.js";
import { loadSupplier } from "./access.js";

// The supplier, checked usable for new business. Tenant-checked only: whoever may create the document may name any of the tenant's suppliers.
export async function assertSupplierUsable(client, organizationId, supplierId, { purpose = "a new purchase order" } = {}) {
  if (!isUuid(supplierId)) throw new SupplierError(400, "Choose the supplier.", "SUPPLIER_INVALID_ID");
  const row = (await client.query(
    `SELECT supplier.*, party.display_name FROM tenant.procurement_suppliers supplier
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2`, [organizationId, supplierId])).rows[0];
  if (!row) throw new SupplierError(409, "That supplier does not exist.", "SUPPLIER_NOT_FOUND");
  if (row.status === SUPPLIER_STATUS.blocked)
    throw new SupplierError(409, `${row.supplier_number} ${row.display_name} is blocked (${row.blocked_reason}) and cannot be used for ${purpose}.`, "SUPPLIER_BLOCKED");
  if (row.status !== SUPPLIER_STATUS.active)
    throw new SupplierError(409, `${row.supplier_number} ${row.display_name} is inactive and cannot be used for ${purpose}.`, "SUPPLIER_INACTIVE");
  return row;
}

const addressSnapshot = (row) => (row ? {
  addressId: row.id, addressType: row.address_type, label: row.label, line1: row.line1, line2: row.line2, city: row.city, district: row.district, state: row.state,
  stateCode: row.state_code, postalCode: row.postal_code, countryCode: row.country_code?.trim() ?? null, gstin: row.gstin, gstRegistrationType: row.gst_registration_type,
} : null);

// Everything a new purchase document starts from. Unscoped by design (see assertSupplierUsable); the screen-facing
// resolveSupplierDefaults checks the caller may see the supplier first.
export async function supplierDefaultsFor(client, organizationId, supplierId, { purpose } = {}) {
  const supplier = await assertSupplierUsable(client, organizationId, supplierId, { purpose });
  const party = (await client.query(`SELECT display_name, legal_name, gstin, pan, tax_treatment, gst_state_code, country_code FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [organizationId, supplier.party_id])).rows[0];
  // The ordering office if there is one, else the default location, else the registered office.
  const ordering = (await client.query(
    `SELECT * FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active'
      ORDER BY (address_type = 'ordering') DESC, is_primary DESC, (address_type = 'registered') DESC, created_at LIMIT 1`, [organizationId, supplier.id])).rows[0];
  const dispatch = (await client.query(
    `SELECT * FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active' AND address_type = 'dispatch'
      ORDER BY is_primary DESC, created_at`, [organizationId, supplier.id])).rows;
  // The procurement contact if there is one, else the primary contact.
  const contact = (await client.query(
    `SELECT contact.id, COALESCE(NULLIF(contact.display_name, ''), concat_ws(' ', contact.first_name, contact.last_name)) AS name, contact.email, COALESCE(contact.mobile, contact.phone) AS phone,
            link.role
       FROM tenant.procurement_supplier_contacts link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
      WHERE link.organization_id = $1 AND link.supplier_id = $2 AND link.status = 'active'
      ORDER BY (link.role IN ('procurement', 'quotation')) DESC, link.is_primary DESC, link.created_at LIMIT 1`, [organizationId, supplier.id])).rows[0];
  let paymentTerm = null;
  let paymentTermWarning = null;
  try {
    paymentTerm = await purchaseTermSnapshot(client, organizationId, supplier.payment_term_id);
  } catch (error) {
    paymentTermWarning = `${error.message} Choose the payment terms on the document.`;
  }
  return {
    supplierId: supplier.id,
    supplier: {
      id: supplier.id, supplierNumber: supplier.supplier_number, supplierName: party.display_name, legalName: party.legal_name, gstin: ordering?.gstin ?? party.gstin, pan: party.pan,
      gstRegistrationType: ordering?.gst_registration_type ?? party.tax_treatment, registeredStateCode: party.gst_state_code,
      registeredStateName: party.gst_state_code ? gstStateName(party.gst_state_code) : null, countryCode: party.country_code?.trim() ?? null, supplierType: supplier.supplier_type,
    },
    currencyCode: supplier.default_currency?.trim(),
    paymentTerm,
    paymentTermWarning,
    contact: contact ? { contactId: contact.id, name: contact.name, email: contact.email, phone: contact.phone, role: contact.role } : null,
    address: addressSnapshot(ordering),
    dispatchAddresses: dispatch.map(addressSnapshot),
  };
}

// For a screen starting a document from a supplier ("Create Purchase Order" on the supplier, or choosing the supplier on a new order).
export async function resolveSupplierDefaults(client, context, supplierId) {
  const supplier = await loadSupplier(client, context, supplierId);
  return supplierDefaultsFor(client, context.organizationId, supplier.id);
}
