// Duplicate detection for leads. A candidate is compared with existing leads,
// contacts AND accounts, so a person who is already a contact, or a company
// that is already an account, is recognized before a second record exists.
//
// Matching uses the normalized columns the database maintains.
//   Strong (the save is refused unless overridden):
//     same email · same mobile · same phone number and the same name
//   Possible (a warning):
//     same phone alone (offices share numbers) · same name at the same
//     company · same name · an existing account for the lead's company
//
// Archived leads and inactive contacts are matched too, so an archived
// record is restored rather than recreated; records merged into another are
// not, because the record they became is what matches. Used by manual
// creation, editing, import, integrations and conversion.
import { findDuplicateAccounts } from "../accounts/duplicates.js";
import { contactScopeSql } from "../contacts/access.js";
import { mergedSql, withoutClearedPairs } from "../duplicates/decisions.js";
import { normalizeEmail, normalizePhone } from "../duplicates/normalize.js";
import { enforceDuplicatePolicy, lockDuplicateKeys } from "../duplicates/policy.js";
import { gradeMatch, sortMatches } from "../duplicates/scoring.js";
import { leadScopeSql } from "./access.js";
import { isUuid } from "./validation.js";

const text = (value) => String(value ?? "").trim();

function fullName(input) {
  return `${text(input.firstName)} ${text(input.lastName)}`.trim();
}

// A shared phone number with the same name is one person; without the name
// it is only a hint.
function personSignals(signals) {
  if (signals.includes("phone") && (signals.includes("name") || signals.includes("name_company")))
    return [...signals.filter((signal) => signal !== "phone"), "phone_name"];
  return signals;
}

const PROBE = `WITH probe AS (
       SELECT tenant.crm_normalize_email($2) AS email,
              ARRAY(SELECT tenant.crm_normalize_phone(value) FROM unnest($3::text[]) AS value) AS phones,
              tenant.crm_normalize_comparison_text($4) AS name,
              tenant.crm_normalize_comparison_text($5) AS company)`;

// Returns { matches, hasBlockingMatch }. Each match says what it is (lead,
// contact or account), why it matched (signals, reasons), how strongly
// (strength, matchStrength, score) and whether the caller may open it — a
// match the caller cannot see is reported without its details.
export async function findLeadDuplicates(client, context, input = {}, { excludeLeadId = null, limit = 10 } = {}) {
  const email = text(input.email);
  const phones = [text(input.mobile), text(input.phone)].filter(Boolean);
  const name = fullName(input);
  const company = text(input.companyName);
  if (!email && !phones.length && !name && !company) return { matches: [], hasBlockingMatch: false };
  const exclude = isUuid(excludeLeadId) ? excludeLeadId : null;
  const person = Boolean(email || phones.length || name);

  const leadValues = [context.organizationId, email || null, phones, name || null, company || null, exclude];
  const leadVisible = leadScopeSql(context, leadValues, "lead");
  const leads = person ? await client.query(
    `${PROBE}
     SELECT lead.id, lead.code, lead.full_name, lead.company_name, lead.email, lead.mobile, lead.phone, lead.status, lead.archived_at,
            owner.full_name AS owner_name,
            (true${leadVisible}) AS can_open,
            array_remove(ARRAY[
              CASE WHEN probe.email IS NOT NULL AND lead.normalized_email = probe.email THEN 'email' END,
              CASE WHEN lead.normalized_mobile = ANY (probe.phones) THEN 'mobile' END,
              CASE WHEN lead.normalized_business_phone = ANY (probe.phones) AND NOT COALESCE(lead.normalized_mobile = ANY (probe.phones), false) THEN 'phone' END,
              CASE WHEN probe.name IS NOT NULL AND probe.company IS NOT NULL AND lead.normalized_name = probe.name AND lead.normalized_company_name = probe.company THEN 'name_company' END,
              CASE WHEN probe.name IS NOT NULL AND lead.normalized_name = probe.name THEN 'name' END
            ], NULL) AS signals
       FROM tenant.crm_leads lead
       CROSS JOIN probe
       LEFT JOIN public.users owner ON owner.id = lead.owner_user_id
      WHERE lead.organization_id = $1 AND ($6::uuid IS NULL OR lead.id <> $6) AND NOT ${mergedSql("lead", "lead")}
        AND ((probe.email IS NOT NULL AND lead.normalized_email = probe.email)
          OR lead.normalized_mobile = ANY (probe.phones)
          OR lead.normalized_business_phone = ANY (probe.phones)
          OR (probe.name IS NOT NULL AND lead.normalized_name = probe.name))
      ORDER BY lead.updated_at DESC
      LIMIT ${Number(limit)}`,
    leadValues,
  ) : { rows: [] };

  const contactValues = [context.organizationId, email || null, phones, name || null, company || null];
  const bind = (value) => { contactValues.push(value); return `$${contactValues.length}`; };
  const contactVisible = contactScopeSql(context, bind, "contact");
  const contacts = person ? await client.query(
    `${PROBE}
     SELECT contact.id, contact.contact_number AS code, contact.party_id, btrim(contact.first_name || ' ' || COALESCE(contact.last_name, '')) AS full_name,
            account.display_name AS company_name, contact.email, contact.mobile, contact.phone, contact.status AS record_status,
            (true${contactVisible}) AS can_open,
            array_remove(ARRAY[
              CASE WHEN probe.email IS NOT NULL AND contact.normalized_email = probe.email THEN 'email' END,
              CASE WHEN contact.normalized_mobile = ANY (probe.phones) THEN 'mobile' END,
              CASE WHEN tenant.crm_normalize_phone(contact.phone) = ANY (probe.phones) AND NOT COALESCE(contact.normalized_mobile = ANY (probe.phones), false) THEN 'phone' END,
              CASE WHEN probe.name IS NOT NULL AND probe.company IS NOT NULL AND contact.normalized_name = probe.name
                    AND tenant.crm_normalize_comparison_text(account.display_name) = probe.company THEN 'name_company' END,
              CASE WHEN probe.name IS NOT NULL AND contact.normalized_name = probe.name THEN 'name' END
            ], NULL) AS signals
       FROM tenant.contacts contact
       CROSS JOIN probe
       LEFT JOIN tenant.business_parties account ON account.organization_id = contact.organization_id AND account.id = contact.party_id
      WHERE contact.organization_id = $1 AND NOT ${mergedSql("contact", "contact")}
        AND ((probe.email IS NOT NULL AND contact.normalized_email = probe.email)
          OR contact.normalized_mobile = ANY (probe.phones)
          OR tenant.crm_normalize_phone(contact.phone) = ANY (probe.phones)
          OR (probe.name IS NOT NULL AND contact.normalized_name = probe.name))
      ORDER BY contact.updated_at DESC
      LIMIT ${Number(limit)}`,
    contactValues,
  ) : { rows: [] };

  const project = (kind) => (row) => {
    const signals = personSignals(row.signals);
    const match = { kind, id: row.id, signals, ...gradeMatch(kind, signals), canOpen: row.can_open };
    if (!row.can_open) return match;
    return {
      ...match,
      name: row.full_name,
      companyName: row.company_name,
      email: row.email,
      phone: row.mobile || row.phone,
      code: row.code,
      ...(kind === "lead"
        ? { status: row.status, ownerName: row.owner_name, isArchived: Boolean(row.archived_at) }
        : { partyId: row.party_id, isArchived: row.record_status === "archived", isInactive: row.record_status === "inactive" }),
    };
  };

  // The lead's company may already be an account. That never blocks a lead
  // (a new person at a known company is a good lead); it tells the
  // salesperson the account exists, and conversion will offer to use it.
  const accounts = company
    ? (await findDuplicateAccounts(client, context, { displayName: company, website: input.website, email: input.email, phone: input.phone, city: input.city }, { limit: 5 })).matches
    : [];
  const accountMatches = accounts.filter((match) => match.canOpen).map((match) => ({
    kind: "account", id: match.id, signals: match.signals, strength: "possible", matchStrength: "possible", score: Math.min(match.score, 89), reasons: match.reasons,
    canOpen: true, name: match.name, code: match.code, companyName: match.name, ownerName: match.ownerName, isArchived: match.status === "archived",
  }));

  const matches = await withoutClearedPairs(
    client, context, "lead", exclude,
    sortMatches([...leads.rows.map(project("lead")), ...contacts.rows.map(project("contact")), ...accountMatches]),
    (match) => match.kind,
  );
  return { matches, hasBlockingMatch: matches.some((match) => match.strength === "exact") };
}

// The single duplicate check for saving a lead. Refuses a strong duplicate
// unless the caller may override and says why (allowDuplicate + reason); the
// caller records the override against the saved lead.
export async function assertNoBlockingLeadDuplicate(client, context, input, { excludeLeadId = null, allowDuplicate = false, reason = null } = {}) {
  await lockDuplicateKeys(client, context, "person", [normalizeEmail(input.email), normalizePhone(input.mobile), normalizePhone(input.phone)]);
  const result = await findLeadDuplicates(client, context, input, { excludeLeadId });
  return enforceDuplicatePolicy(context, result, {
    allowDuplicate, reason, code: "CRM_LEAD_DUPLICATE", message: "This looks like a duplicate of an existing record.",
  });
}
