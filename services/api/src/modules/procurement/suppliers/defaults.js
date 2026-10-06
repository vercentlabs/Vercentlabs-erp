// What a new document takes from its supplier, once.
//
// Each document resolves the supplier-side context it needs from the
// supplier's defaults (never "the first address"), and keeps both the link
// and a snapshot of each value. From then on the document owns them:
// changing or deactivating the supplier's location, person or GST
// registration later never changes an existing document.
//
//   rfq             RFQ contact (else primary), ordering address
//   purchase_order  ordering contact (else primary), ordering address,
//                   ship-from location, and the GST registration of the
//                   ship-from (else ordering) location, else the principal
//   goods_receipt   dispatch contact (else ordering, else primary), ship-from
//   bill            accounts contact (else primary), billing address (else
//                   registered), and that location's registration
//   return          return-to address (else ship-from), dispatch contact
//
// Only an active supplier starts new business, and only active locations and
// people are offered or accepted. This is checked here, on the server.
import { purchaseTermSnapshot } from "../../../core/payment-terms/index.js";
import { gstStateName } from "../../../core/tax/index.js";
import { SUPPLIER_STATUS, SupplierError, isUuid } from "./constants.js";
import { loadSupplier } from "./access.js";
import { ADDRESS_SELECT } from "./addresses.js";
import { CONTACT_SELECT } from "./contacts.js";
import { readDefaults } from "./default-assignments.js";

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
  addressId: row.id, label: row.label, purposes: [...row.purposes], line1: row.line1, line2: row.line2, locality: row.locality, city: row.city, district: row.district,
  state: row.state, stateCode: row.state_code, postalCode: row.postal_code, countryCode: row.country_code?.trim() ?? null, email: row.location_email, phone: row.location_phone,
  gstin: row.registration_status === "active" ? row.registration_gstin : null,
} : null);
const contactSnapshot = (row) => (row ? {
  contactId: row.contact_id, relationshipId: row.id, name: row.name, designation: row.designation, email: row.email, phone: row.mobile ?? row.phone, roles: [...row.roles],
} : null);
const registrationSnapshot = (row) => (row ? {
  registrationId: row.id, gstin: row.gstin, registrationType: row.registration_type, stateCode: row.state_code, stateName: gstStateName(row.state_code),
} : null);

async function activeAddress(client, organizationId, supplierId, id) {
  if (!id) return null;
  return (await client.query(`${ADDRESS_SELECT} WHERE address.organization_id = $1 AND address.supplier_id = $2 AND address.id = $3 AND address.status = 'active'`,
    [organizationId, supplierId, id])).rows[0] ?? null;
}
async function activeContact(client, organizationId, supplierId, id) {
  if (!id) return null;
  return (await client.query(`${CONTACT_SELECT} WHERE link.organization_id = $1 AND link.supplier_id = $2 AND link.id = $3 AND link.status = 'active'`,
    [organizationId, supplierId, id])).rows[0] ?? null;
}
async function registrationFor(client, organizationId, supplierId, ...addresses) {
  const fromLocation = addresses.find((address) => address?.tax_registration_id && address.registration_status === "active");
  const id = fromLocation?.tax_registration_id;
  const { rows } = await client.query(
    `SELECT * FROM tenant.procurement_supplier_tax_registrations WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active' AND (id = $3::uuid OR ($3::uuid IS NULL AND is_principal))`,
    [organizationId, supplierId, id ?? null]);
  return rows[0] ?? null;
}
const first = async (...candidates) => { for (const candidate of candidates) { const value = await candidate(); if (value) return value; } return null; };

// The supplier-side context a new document of this kind starts from. Values are null when the supplier has nothing suitable.
export async function resolveSupplierTransactionDefaults(client, organizationId, supplierId, purpose = "purchase_order") {
  const supplier = (await client.query(`SELECT id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [organizationId, supplierId])).rows[0];
  if (!supplier) throw new SupplierError(404, "Supplier not found.", "SUPPLIER_NOT_FOUND");
  const d = await readDefaults(client, organizationId, supplier.id);
  const address = (id) => () => activeAddress(client, organizationId, supplier.id, id);
  const contact = (id) => () => activeContact(client, organizationId, supplier.id, id);
  switch (purpose) {
    case "rfq": {
      const person = await first(contact(d.rfq_contact_id), contact(d.primary_contact_id));
      return { contact: contactSnapshot(person), address: addressSnapshot(await first(address(d.ordering_address_id))) };
    }
    case "goods_receipt": {
      const person = await first(contact(d.dispatch_contact_id), contact(d.ordering_contact_id), contact(d.primary_contact_id));
      return { contact: contactSnapshot(person), shipFrom: addressSnapshot(await first(address(d.ship_from_address_id))) };
    }
    case "bill": {
      const billing = await first(address(d.billing_address_id), address(d.registered_address_id));
      const person = await first(contact(d.accounts_contact_id), contact(d.primary_contact_id));
      return { contact: contactSnapshot(person), address: addressSnapshot(billing), taxRegistration: registrationSnapshot(await registrationFor(client, organizationId, supplier.id, billing)) };
    }
    case "return": {
      const returnTo = await first(address(d.return_to_address_id), address(d.ship_from_address_id));
      const person = await first(contact(d.dispatch_contact_id), contact(d.primary_contact_id));
      return { contact: contactSnapshot(person), address: addressSnapshot(returnTo) };
    }
    default: {
      const ordering = await first(address(d.ordering_address_id));
      const shipFrom = await first(address(d.ship_from_address_id));
      const person = await first(contact(d.ordering_contact_id), contact(d.primary_contact_id));
      return {
        contact: contactSnapshot(person), address: addressSnapshot(ordering), shipFrom: addressSnapshot(shipFrom),
        taxRegistration: registrationSnapshot(await registrationFor(client, organizationId, supplier.id, shipFrom, ordering)),
      };
    }
  }
}

// A location or person chosen on a document instead of the default: one of this supplier's own, and active. Returns its snapshot.
export async function supplierSelection(client, organizationId, supplierId, kind, id, label) {
  if (!id) return null;
  if (!isUuid(id)) throw new SupplierError(400, `${label} is invalid.`, "SUPPLIER_INVALID_ID");
  const row = kind === "contact" ? await activeContact(client, organizationId, supplierId, id) : await activeAddress(client, organizationId, supplierId, id);
  if (!row) throw new SupplierError(409, `${label} must be an active ${kind === "contact" ? "contact" : "location"} of this supplier.`, "SUPPLIER_SELECTION_INVALID");
  return kind === "contact" ? contactSnapshot(row) : addressSnapshot(row);
}

// Everything a new purchase order starts from: the supplier checked usable, its identity, currency, payment terms and the purchase-order context.
export async function supplierDefaultsFor(client, organizationId, supplierId, { purpose } = {}) {
  const supplier = await assertSupplierUsable(client, organizationId, supplierId, { purpose });
  const party = (await client.query(`SELECT display_name, legal_name, gstin, pan, tax_treatment, gst_state_code, country_code FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [organizationId, supplier.party_id])).rows[0];
  const context = await resolveSupplierTransactionDefaults(client, organizationId, supplier.id, "purchase_order");
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
      id: supplier.id, supplierNumber: supplier.supplier_number, supplierName: party.display_name, legalName: party.legal_name, gstin: context.taxRegistration?.gstin ?? party.gstin,
      pan: party.pan, gstRegistrationType: context.taxRegistration?.registrationType ?? party.tax_treatment, registeredStateCode: party.gst_state_code,
      registeredStateName: party.gst_state_code ? gstStateName(party.gst_state_code) : null, countryCode: party.country_code?.trim() ?? null, supplierType: supplier.supplier_type,
    },
    currencyCode: supplier.default_currency?.trim(),
    paymentTerm,
    paymentTermWarning,
    contact: context.contact,
    address: context.address,
    shipFrom: context.shipFrom,
    taxRegistration: context.taxRegistration,
  };
}

// For a screen starting a document from a supplier: purpose rfq | purchase_order | goods_receipt | bill | return.
export async function resolveSupplierDefaults(client, context, supplierId, purpose = "purchase_order") {
  const supplier = await loadSupplier(client, context, supplierId);
  if (purpose === "purchase_order") return supplierDefaultsFor(client, context.organizationId, supplier.id);
  return { supplierId: supplier.id, purpose, ...(await resolveSupplierTransactionDefaults(client, context.organizationId, supplier.id, purpose)) };
}

// The GST registration a document uses: that of the first given location that has an active one, else the supplier's principal registration.
export async function registrationSnapshotFor(client, organizationId, supplierId, ...addressIds) {
  const addresses = [];
  for (const id of addressIds.filter(Boolean)) addresses.push(await activeAddress(client, organizationId, supplierId, id));
  return registrationSnapshot(await registrationFor(client, organizationId, supplierId, ...addresses));
}
