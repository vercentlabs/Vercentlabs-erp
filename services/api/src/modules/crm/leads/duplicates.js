// Duplicate detection for leads. A candidate is compared with existing leads
// AND contacts, so a lead converted yesterday is not recreated today.
//
// Matching uses the normalized columns the database maintains:
//   email            -> exact match (blocking)
//   mobile / phone   -> exact match on digits (blocking)
//   name + company   -> same person at the same company (blocking)
//   name only        -> possible match (warning, never blocks)
// A blocking match refuses the save unless the caller confirms it is not a
// duplicate (allowDuplicate). Used by manual creation, import, integrations
// and conversion.
import { crmContactVisibleSql } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { leadScopeSql } from "./access.js";
import { isUuid } from "./validation.js";

const BLOCKING_SIGNALS = new Set(["email", "phone", "name_company"]);

const text = (value) => String(value ?? "").trim();

function fullName(input) {
  return `${text(input.firstName)} ${text(input.lastName)}`.trim();
}

function strength(signals) {
  return signals.some((signal) => BLOCKING_SIGNALS.has(signal)) ? "exact" : "possible";
}

// Returns { matches, hasBlockingMatch }. Each match says what it is (lead or
// contact), why it matched, and whether the caller is allowed to open it —
// a match the caller cannot see is reported without its details.
export async function findLeadDuplicates(client, context, input = {}, { excludeLeadId = null, limit = 10 } = {}) {
  const email = text(input.email);
  const phones = [text(input.mobile), text(input.phone)].filter(Boolean);
  const name = fullName(input);
  const company = text(input.companyName);
  if (!email && !phones.length && !name) return { matches: [], hasBlockingMatch: false };
  const exclude = isUuid(excludeLeadId) ? excludeLeadId : null;

  const leadValues = [context.organizationId, email || null, phones, name || null, company || null, exclude];
  const leadVisible = leadScopeSql(context, leadValues, "lead");
  const leads = await client.query(
    `WITH probe AS (
       SELECT tenant.crm_normalize_email($2) AS email,
              ARRAY(SELECT tenant.crm_normalize_phone(value) FROM unnest($3::text[]) AS value) AS phones,
              tenant.crm_normalize_comparison_text($4) AS name,
              tenant.crm_normalize_comparison_text($5) AS company)
     SELECT lead.id, lead.code, lead.full_name, lead.company_name, lead.email, lead.mobile, lead.phone, lead.status,
            owner.full_name AS owner_name,
            (true${leadVisible}) AS can_open,
            array_remove(ARRAY[
              CASE WHEN probe.email IS NOT NULL AND lead.normalized_email = probe.email THEN 'email' END,
              CASE WHEN lead.normalized_mobile = ANY (probe.phones) OR lead.normalized_business_phone = ANY (probe.phones) THEN 'phone' END,
              CASE WHEN probe.name IS NOT NULL AND probe.company IS NOT NULL AND lead.normalized_name = probe.name AND lead.normalized_company_name = probe.company THEN 'name_company' END,
              CASE WHEN probe.name IS NOT NULL AND lead.normalized_name = probe.name THEN 'name' END
            ], NULL) AS signals
       FROM tenant.crm_leads lead
       CROSS JOIN probe
       LEFT JOIN public.users owner ON owner.id = lead.owner_user_id
      WHERE lead.organization_id = $1 AND lead.archived_at IS NULL AND ($6::uuid IS NULL OR lead.id <> $6)
        AND ((probe.email IS NOT NULL AND lead.normalized_email = probe.email)
          OR lead.normalized_mobile = ANY (probe.phones)
          OR lead.normalized_business_phone = ANY (probe.phones)
          OR (probe.name IS NOT NULL AND lead.normalized_name = probe.name))
      ORDER BY lead.updated_at DESC
      LIMIT ${Number(limit)}`,
    leadValues,
  );

  const contactValues = [context.organizationId, email || null, phones, name || null, company || null];
  const bind = (value) => { contactValues.push(value); return `$${contactValues.length}`; };
  const contactVisible = crmContactVisibleSql(context, bind, "contact", "account");
  const contacts = await client.query(
    `WITH probe AS (
       SELECT tenant.crm_normalize_email($2) AS email,
              ARRAY(SELECT tenant.crm_normalize_phone(value) FROM unnest($3::text[]) AS value) AS phones,
              tenant.crm_normalize_comparison_text($4) AS name,
              tenant.crm_normalize_comparison_text($5) AS company)
     SELECT contact.id, contact.party_id, btrim(contact.first_name || ' ' || COALESCE(contact.last_name, '')) AS full_name,
            account.display_name AS company_name, contact.email, contact.mobile, contact.phone,
            (true${contactVisible}) AS can_open,
            array_remove(ARRAY[
              CASE WHEN probe.email IS NOT NULL AND contact.normalized_email = probe.email THEN 'email' END,
              CASE WHEN contact.normalized_mobile = ANY (probe.phones)
                     OR tenant.crm_normalize_phone(contact.phone) = ANY (probe.phones) THEN 'phone' END,
              CASE WHEN probe.name IS NOT NULL AND probe.company IS NOT NULL AND contact.normalized_name = probe.name
                    AND tenant.crm_normalize_comparison_text(account.display_name) = probe.company THEN 'name_company' END,
              CASE WHEN probe.name IS NOT NULL AND contact.normalized_name = probe.name THEN 'name' END
            ], NULL) AS signals
       FROM tenant.contacts contact
       CROSS JOIN probe
       LEFT JOIN tenant.business_parties account ON account.organization_id = contact.organization_id AND account.id = contact.party_id
      WHERE contact.organization_id = $1 AND contact.status = 'active' AND contact.archived_at IS NULL
        AND ((probe.email IS NOT NULL AND contact.normalized_email = probe.email)
          OR contact.normalized_mobile = ANY (probe.phones)
          OR tenant.crm_normalize_phone(contact.phone) = ANY (probe.phones)
          OR (probe.name IS NOT NULL AND contact.normalized_name = probe.name))
      ORDER BY contact.updated_at DESC
      LIMIT ${Number(limit)}`,
    contactValues,
  );

  const project = (kind) => (row) => {
    const match = { kind, id: row.id, signals: row.signals, strength: strength(row.signals), canOpen: row.can_open };
    if (!row.can_open) return match;
    return {
      ...match,
      name: row.full_name,
      companyName: row.company_name,
      email: row.email,
      phone: row.mobile || row.phone,
      ...(kind === "lead" ? { code: row.code, status: row.status, ownerName: row.owner_name } : { partyId: row.party_id }),
    };
  };
  const matches = [...leads.rows.map(project("lead")), ...contacts.rows.map(project("contact"))]
    .sort((left, right) => (left.strength === right.strength ? 0 : left.strength === "exact" ? -1 : 1));
  return { matches, hasBlockingMatch: matches.some((match) => match.strength === "exact") };
}

// Refuses an obvious duplicate. `allowDuplicate` is the caller's explicit
// "this is a different person" confirmation, recorded in the lead history by
// the caller.
export async function assertNoBlockingLeadDuplicate(client, context, input, { excludeLeadId = null, allowDuplicate = false } = {}) {
  const result = await findLeadDuplicates(client, context, input, { excludeLeadId });
  if (result.hasBlockingMatch && !allowDuplicate)
    throw new CrmError(409, "This looks like a duplicate of an existing record.", "CRM_LEAD_DUPLICATE", { matches: result.matches });
  return result;
}
