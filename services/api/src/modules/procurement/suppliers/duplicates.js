// Finding the supplier that already exists.
//
// Matching is deterministic: values are normalized by the same database
// functions CRM and Customers use ("ABC Industries Pvt Ltd" and "ABC
// INDUSTRIES" are one company name), plus a trigram similarity for names
// that are nearly the same in the same city.
//
//   GSTIN       one registration is one legal entity: a GSTIN that already
//               belongs to a supplier is refused outright; one on another
//               organization (a customer, an account) means "add the supplier
//               role to it", never a second identity.
//   strong      the same PAN, or the same normalized name or legal name:
//               creating anyway needs a reason, recorded in the history.
//   possible    the same email, phone or website, or a very similar name in
//               the same city: shown as a warning only.
//
// "ABC Engineering" and "ABC Engineering Services" are only similar, so they
// warn and never block.
import { SupplierError, text } from "./constants.js";
import { supplierCan } from "./access.js";
import { SUPPLIER_PERMISSIONS } from "./constants.js";

const REASONS = Object.freeze({
  gstin: { label: "Same GSTIN", strong: true },
  pan: { label: "Same PAN", strong: true },
  name: { label: "Same name", strong: true },
  legal_name: { label: "Same legal name", strong: true },
  email: { label: "Same email", strong: false },
  phone: { label: "Same phone", strong: false },
  website: { label: "Same website", strong: false },
  name_city: { label: "Similar name in the same city", strong: false },
  similar_name: { label: "Similar name", strong: false },
});

// probe: { supplierName, legalName, gstin, pan, website, primaryEmail, primaryPhone, city }
// options: { excludeSupplierId, excludePartyId }
// Returns matches, strongest first: { kind: "supplier" | "organization", supplierId, partyId, number, name, legalName, gstin, city, status,
//   strength: "strong" | "possible", reasons: [{ code, label }], canOpen }
export async function checkSupplierDuplicates(client, context, probe = {}, { excludeSupplierId = null, excludePartyId = null } = {}) {
  const name = text(probe.supplierName);
  const legal = text(probe.legalName);
  const gstin = text(probe.gstin)?.toUpperCase() ?? null;
  const pan = text(probe.pan)?.toUpperCase() ?? null;
  const city = text(probe.city)?.toLowerCase() ?? null;
  if (!name && !legal && !gstin && !pan && !text(probe.primaryEmail) && !text(probe.primaryPhone) && !text(probe.website)) return [];
  const values = [context.organizationId, name, legal, gstin, pan, text(probe.website), text(probe.primaryEmail), text(probe.primaryPhone), city, excludeSupplierId, excludePartyId];
  const { rows } = await client.query(
    `WITH probe AS (
       SELECT tenant.crm_normalize_company_name($2) AS name, tenant.crm_normalize_company_name($3) AS legal, $4::text AS gstin, $5::text AS pan,
              tenant.crm_web_domain($6) AS domain, tenant.crm_normalize_email($7) AS email, tenant.crm_normalize_phone($8) AS phone, $9::text AS city)
     SELECT party.id AS party_id, supplier.id AS supplier_id, supplier.supplier_number, party.display_name, party.legal_name, party.gstin, supplier.status,
            party.customer_number, location.city,
            array_remove(ARRAY[
              CASE WHEN probe.gstin IS NOT NULL AND (upper(party.gstin) = probe.gstin OR EXISTS (SELECT 1 FROM tenant.procurement_supplier_tax_registrations registration
                     WHERE registration.organization_id = party.organization_id AND registration.supplier_id = supplier.id AND registration.gstin = probe.gstin)) THEN 'gstin' END,
              CASE WHEN probe.pan IS NOT NULL AND party.normalized_pan = probe.pan THEN 'pan' END,
              CASE WHEN probe.name IS NOT NULL AND (party.normalized_company_name = probe.name OR party.normalized_legal_company_name = probe.name) THEN 'name' END,
              CASE WHEN probe.legal IS NOT NULL AND probe.legal IS DISTINCT FROM probe.name
                     AND (party.normalized_legal_company_name = probe.legal OR party.normalized_company_name = probe.legal) THEN 'legal_name' END,
              CASE WHEN probe.email IS NOT NULL AND (supplier.normalized_email = probe.email OR tenant.crm_normalize_email(party.email) = probe.email) THEN 'email' END,
              CASE WHEN probe.phone IS NOT NULL AND (supplier.normalized_phone = probe.phone OR tenant.crm_normalize_phone(party.phone) = probe.phone) THEN 'phone' END,
              CASE WHEN probe.domain IS NOT NULL AND party.website_domain = probe.domain THEN 'website' END,
              CASE WHEN probe.name IS NOT NULL AND probe.city IS NOT NULL AND lower(location.city) = probe.city AND party.normalized_company_name <> probe.name
                     AND similarity(party.normalized_company_name, probe.name) >= 0.55 THEN 'name_city' END,
              CASE WHEN probe.name IS NOT NULL AND party.normalized_company_name <> probe.name AND similarity(party.normalized_company_name, probe.name) >= 0.6 THEN 'similar_name' END
            ], NULL) AS signals
       FROM probe
       JOIN tenant.business_parties party ON party.organization_id = $1 AND party.status <> 'archived'
       LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = party.organization_id AND supplier.party_id = party.id
       LEFT JOIN LATERAL (
         SELECT address.city FROM tenant.procurement_supplier_addresses address
          WHERE address.organization_id = party.organization_id AND address.supplier_id = supplier.id AND address.status = 'active'
          ORDER BY address.created_at LIMIT 1) supplier_city ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(supplier_city.city, (SELECT party_address.city FROM tenant.addresses party_address
                  WHERE party_address.organization_id = party.organization_id AND party_address.party_id = party.id AND party_address.status = 'active'
                  ORDER BY party_address.is_primary DESC, party_address.created_at LIMIT 1)) AS city) location ON true
      WHERE ($10::uuid IS NULL OR supplier.id IS NULL OR supplier.id <> $10::uuid) AND ($11::uuid IS NULL OR party.id <> $11::uuid)
        AND (
          (probe.gstin IS NOT NULL AND (upper(party.gstin) = probe.gstin OR EXISTS (SELECT 1 FROM tenant.procurement_supplier_tax_registrations registration
             WHERE registration.organization_id = party.organization_id AND registration.supplier_id = supplier.id AND registration.gstin = probe.gstin)))
          OR (probe.pan IS NOT NULL AND party.normalized_pan = probe.pan)
          OR (probe.name IS NOT NULL AND (party.normalized_company_name = probe.name OR party.normalized_legal_company_name = probe.name
                OR similarity(party.normalized_company_name, probe.name) >= 0.55))
          OR (probe.legal IS NOT NULL AND (party.normalized_legal_company_name = probe.legal OR party.normalized_company_name = probe.legal))
          OR (probe.email IS NOT NULL AND (supplier.normalized_email = probe.email OR tenant.crm_normalize_email(party.email) = probe.email))
          OR (probe.phone IS NOT NULL AND (supplier.normalized_phone = probe.phone OR tenant.crm_normalize_phone(party.phone) = probe.phone))
          OR (probe.domain IS NOT NULL AND party.website_domain = probe.domain))
      LIMIT 50`, values);
  const viewAll = supplierCan(context, SUPPLIER_PERMISSIONS.viewAll);
  return rows
    .filter((row) => row.signals.length > 0)
    .map((row) => {
      const reasons = row.signals.map((code) => ({ code, label: REASONS[code].label }));
      return {
        kind: row.supplier_id ? "supplier" : "organization",
        supplierId: row.supplier_id ?? null,
        partyId: row.party_id,
        number: row.supplier_number ?? row.customer_number ?? null,
        name: row.display_name,
        legalName: row.legal_name,
        gstin: row.gstin,
        city: row.city ?? null,
        status: row.status ?? null,
        isCustomer: Boolean(row.customer_number),
        strength: row.signals.some((code) => REASONS[code].strong) ? "strong" : "possible",
        reasons,
        canOpen: Boolean(row.supplier_id) && viewAll,
      };
    })
    .sort((left, right) => (left.strength === right.strength ? (left.kind === right.kind ? 0 : left.kind === "supplier" ? -1 : 1) : left.strength === "strong" ? -1 : 1));
}

// Refuses what must never be created twice, and a strong match unless the caller confirmed it with a reason.
// Returns the matches (for the history).
export async function assertNoBlockingSupplierDuplicate(client, context, probe, { allowDuplicate = false, reason = null, excludeSupplierId = null, excludePartyId = null } = {}) {
  const matches = await checkSupplierDuplicates(client, context, probe, { excludeSupplierId, excludePartyId });
  const sameGstin = matches.find((match) => match.reasons.some((entry) => entry.code === "gstin"));
  if (sameGstin?.kind === "supplier")
    throw new SupplierError(409, `GSTIN ${probe.gstin} already belongs to ${sameGstin.number} ${sameGstin.name}. Use that supplier.`, "SUPPLIER_GSTIN_TAKEN", { matches: [sameGstin] });
  if (sameGstin)
    throw new SupplierError(409, `GSTIN ${probe.gstin} belongs to ${sameGstin.name}${sameGstin.isCustomer ? " (a customer)" : ""}. Add the supplier role to it instead of creating a second company.`,
      "SUPPLIER_ORGANIZATION_EXISTS", { matches: [sameGstin] });
  const strong = matches.filter((match) => match.strength === "strong");
  if (strong.length && !allowDuplicate)
    throw new SupplierError(409, "This looks like a supplier or company that already exists.", "SUPPLIER_DUPLICATE", { matches, canOverride: true });
  if (strong.length && (text(reason)?.length ?? 0) < 5)
    throw new SupplierError(400, "Say why this is a different supplier (at least 5 characters).", "SUPPLIER_DUPLICATE_REASON", { matches, canOverride: true });
  return matches;
}
