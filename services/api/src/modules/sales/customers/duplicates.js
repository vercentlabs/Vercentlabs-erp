// Duplicate customer detection, run before a customer is created and when
// its identity changes. It uses the company matcher CRM uses, because a
// customer and its account are one record, and grades the result the way the
// Customer Master needs:
//
// Strong (the save is refused unless overridden):
//   the same GSTIN, the same legal name, or the same website domain
// Possible (a warning only):
//   the same or a similar customer name, the same phone or email, or a
//   related name in the same city
//
// A match that is a CRM account but not yet a customer is reported as such:
// the right action is to create the customer from that account.
import { findDuplicateAccounts } from "../../crm/accounts/duplicates.js";
import { lockDuplicateKeys, recordDuplicateOverride } from "../../crm/duplicates/policy.js";
import { normalizeCompanyName, normalizeDomain, normalizeGstin } from "../../crm/duplicates/normalize.js";
import { crmContext, customerCan, requireCustomerPermission } from "./access.js";
import { CUSTOMER_PERMISSIONS, CustomerError } from "./constants.js";
import { isUuid, text } from "./validation.js";

const STRONG_SIGNALS = new Set(["gstin", "website", "website_name", "legal_name"]);
const LABELS = Object.freeze({
  gstin: "Same GSTIN", legal_name: "Same legal name", website: "Same website", website_name: "Same website",
  name: "Same customer name", similar_name: "Similar name", name_city: "Similar name in the same city", name_phone: "Similar name and the same phone",
  name_email_domain: "Similar name and the same email domain", phone: "Same phone", email: "Same email",
});
const ORDER = ["gstin", "legal_name", "website", "website_name", "name", "phone", "email", "name_city", "name_phone", "name_email_domain", "similar_name"];
const same = (left, right) => Boolean(text(left)) && normalizeCompanyName(left) === normalizeCompanyName(right);

// Who may save a customer although it strongly matches another one.
export const canOverrideCustomerDuplicate = (context) =>
  customerCan(context, "crm.duplicates.override") || customerCan(context, "sales.settings.manage");

// input: { displayName, legalName, website, email, phone, gstin, city }
// Returns { matches, hasBlockingMatch }.
export async function findDuplicateCustomers(client, context, input = {}, { excludeId = null, limit = 10 } = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  const found = await findDuplicateAccounts(client, crmContext(context), input, { excludeId, limit });
  const byId = new Map(found.matches.map((match) => [match.id, { ...match, signals: [...match.signals] }]));

  // The same phone or email on its own is worth a warning too.
  const phone = text(input.phone);
  const email = text(input.email).toLowerCase();
  if (phone || email) {
    const { rows } = await client.query(
      `SELECT party.id, party.code, party.display_name, party.legal_name, party.website, party.status, party.customer_number, party.party_type,
              (tenant.crm_normalize_phone(party.phone) = tenant.crm_normalize_phone($2)) AS same_phone, (lower(party.email) = $3) AS same_email
         FROM tenant.business_parties party
        WHERE party.organization_id = $1 AND party.party_type <> 'supplier' AND ($4::uuid IS NULL OR party.id <> $4)
          AND (($2 <> '' AND tenant.crm_normalize_phone(party.phone) = tenant.crm_normalize_phone($2)) OR ($3 <> '' AND lower(party.email) = $3))
        LIMIT 10`,
      [context.organizationId, phone, email, isUuid(excludeId) ? excludeId : null],
    );
    for (const row of rows) {
      const match = byId.get(row.id) ?? {
        kind: "account", id: row.id, signals: [], canOpen: true, code: row.code, name: row.display_name, legalName: row.legal_name, website: row.website,
        status: row.status, isCustomer: Boolean(row.customer_number) || ["customer", "both"].includes(row.party_type), customerNumber: row.customer_number,
      };
      if (row.same_phone) match.signals.push("phone");
      if (row.same_email) match.signals.push("email");
      byId.set(row.id, match);
    }
  }

  const matches = [...byId.values()].map((match) => {
    const signals = new Set(match.signals);
    if (same(input.legalName, match.legalName)) signals.add("legal_name");
    if (signals.has("website") || signals.has("website_name")) { signals.delete("website_name"); signals.add("website"); }
    if (signals.has("name")) signals.delete("similar_name");
    const ordered = ORDER.filter((signal) => signals.has(signal));
    const strong = ordered.some((signal) => STRONG_SIGNALS.has(signal));
    return {
      id: match.id,
      customerNumber: match.customerNumber ?? null,
      accountNumber: match.code ?? null,
      name: match.name ?? null,
      legalName: match.legalName ?? null,
      city: match.city ?? null,
      status: match.status ?? null,
      isCustomer: Boolean(match.isCustomer),
      strength: strong ? "strong" : "possible",
      reasons: ordered.map((signal) => ({ signal, label: LABELS[signal] ?? signal, strong: STRONG_SIGNALS.has(signal) })),
      href: match.isCustomer ? `/sales/customers/${match.id}` : `/crm/accounts/${match.id}`,
    };
  }).filter((match) => match.reasons.length)
    .sort((left, right) => (left.strength === right.strength ? right.reasons.length - left.reasons.length : left.strength === "strong" ? -1 : 1))
    .slice(0, Number(limit));
  return { matches, hasBlockingMatch: matches.some((match) => match.strength === "strong"), canOverride: canOverrideCustomerDuplicate(context) };
}

// The duplicate check for saving a customer. A strong match refuses the save
// unless the caller may override and says why.
export async function assertNoBlockingCustomerDuplicate(client, context, input, { excludeId = null, allowDuplicate = false, reason = null } = {}) {
  await lockDuplicateKeys(client, context, "company", [
    normalizeGstin(input.gstin), normalizeDomain(input.website), normalizeCompanyName(input.displayName), normalizeCompanyName(input.legalName),
  ]);
  const result = await findDuplicateCustomers(client, context, input, { excludeId });
  if (!result.hasBlockingMatch) return result;
  const details = { duplicateDetected: true, canOverride: result.canOverride, matches: result.matches };
  if (!allowDuplicate) throw new CustomerError(409, "A customer like this already exists.", "SALES_CUSTOMER_DUPLICATE", details);
  if (!result.canOverride)
    throw new CustomerError(403, "You do not have permission to create a customer that matches an existing one. Use the existing customer, or ask a manager.", "SALES_CUSTOMER_DUPLICATE_OVERRIDE_FORBIDDEN", details);
  const cleanReason = text(reason).slice(0, 500);
  if (!cleanReason) throw new CustomerError(400, "Explain why this is not a duplicate of the existing customer.", "SALES_CUSTOMER_DUPLICATE_REASON_REQUIRED", details);
  const strong = result.matches.filter((match) => match.strength === "strong");
  return { ...result, override: { reason: cleanReason, matches: strong.map((match) => ({ kind: "account", id: match.id, matchStrength: "strong", signals: match.reasons.map((entry) => entry.signal) })) } };
}

export async function recordCustomerDuplicateOverride(client, context, partyId, result) {
  if (result?.override) await recordDuplicateOverride(client, context, "account", partyId, result);
}
