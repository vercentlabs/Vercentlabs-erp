// Duplicate person detection, used by manual creation, editing, import, lead
// conversion and contacts added from an account.
//
// Strong matches (block the save unless the user confirms):
//   the same email (work or secondary) or the same phone number (work,
//   mobile or alternate), compared in normalized form — so "Rahul Sharma"
//   and "Rahul K. Sharma" with the same email are one person
// Possible matches (a warning only):
//   similar name at the same company, similar name with the same email
//   domain, or a near-identical name
import { CrmError } from "../data-management/errors.js";
import { contactScopeSql } from "./access.js";
import { isUuid } from "./validation.js";

const STRONG = new Set(["email", "phone"]);
// A shared mailbox domain says nothing about the company.
const FREE_EMAIL_DOMAINS = ["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com",
  "rediffmail.com", "protonmail.com", "proton.me", "aol.com", "zoho.com", "yandex.com", "msn.com"];
const SIMILAR = 0.85;
const RELATED = 0.5;

const text = (value) => String(value ?? "").trim();

// input: { firstName, middleName, lastName, email, secondaryEmail, phone, mobile, alternatePhone, accountId }
export async function findDuplicateContacts(client, context, input = {}, { excludeId = null, limit = 10 } = {}) {
  const name = [input.firstName, input.lastName].map(text).filter(Boolean).join(" ");
  const emails = [input.email, input.secondaryEmail].map(text).filter(Boolean);
  const phones = [input.phone, input.mobile, input.alternatePhone].map(text).filter(Boolean);
  if (!emails.length && !phones.length && !name) return { matches: [], hasBlockingMatch: false };

  const values = [context.organizationId, emails, phones, name || null, isUuid(input.accountId) ? input.accountId : null,
    FREE_EMAIL_DOMAINS, isUuid(excludeId) ? excludeId : null, SIMILAR, RELATED];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  // Evaluated in the outer SELECT, where the row is `candidate`.
  const visible = contactScopeSql(context, bind, "candidate");
  const { rows } = await client.query(
    `WITH probe AS (
       SELECT ARRAY(SELECT tenant.crm_normalize_email(value) FROM unnest($2::text[]) value WHERE tenant.crm_normalize_email(value) IS NOT NULL) AS p_emails,
              ARRAY(SELECT tenant.crm_normalize_phone(value) FROM unnest($3::text[]) value WHERE length(COALESCE(tenant.crm_normalize_phone(value), '')) >= 7) AS p_phones,
              tenant.crm_normalize_comparison_text($4) AS p_name,
              ARRAY(SELECT split_part(lower(value), '@', 2) FROM unnest($2::text[]) value
                     WHERE split_part(lower(value), '@', 2) <> '' AND NOT (split_part(lower(value), '@', 2) = ANY ($6::text[]))) AS p_domains,
              $5::uuid AS p_account),
     candidates AS (
       SELECT contact.*, probe.*,
              CASE WHEN probe.p_name IS NULL THEN 0 ELSE similarity(COALESCE(contact.normalized_name, ''), probe.p_name) END AS name_similarity,
              ARRAY_REMOVE(ARRAY[contact.normalized_email, contact.normalized_secondary_email], NULL) AS c_emails,
              ARRAY_REMOVE(ARRAY[tenant.crm_normalize_phone(contact.mobile), contact.normalized_work_phone, contact.normalized_alternate_phone], NULL) AS c_phones
         FROM tenant.contacts contact CROSS JOIN probe
        WHERE contact.organization_id = $1 AND contact.status <> 'archived'
          AND ($7::uuid IS NULL OR contact.id <> $7)
          AND (contact.normalized_email = ANY (probe.p_emails) OR contact.normalized_secondary_email = ANY (probe.p_emails)
            OR tenant.crm_normalize_phone(contact.mobile) = ANY (probe.p_phones) OR contact.normalized_work_phone = ANY (probe.p_phones)
            OR contact.normalized_alternate_phone = ANY (probe.p_phones)
            OR (probe.p_name IS NOT NULL AND contact.normalized_name % probe.p_name))
     )
     SELECT candidate.id, candidate.contact_number, candidate.display_name, candidate.first_name, candidate.last_name, candidate.designation,
            candidate.email, candidate.mobile, candidate.status, candidate.party_id, account.display_name AS account_name,
            owner.full_name AS owner_name, (true${visible}) AS can_open,
            array_remove(ARRAY[
              CASE WHEN candidate.c_emails && candidate.p_emails THEN 'email' END,
              CASE WHEN candidate.c_phones && candidate.p_phones THEN 'phone' END,
              CASE WHEN candidate.name_similarity >= $9 AND candidate.p_account IS NOT NULL AND (candidate.party_id = candidate.p_account
                     OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships r WHERE r.organization_id = candidate.organization_id
                                 AND r.contact_id = candidate.id AND r.party_id = candidate.p_account)) THEN 'name_company' END,
              CASE WHEN candidate.name_similarity >= $9 AND cardinality(candidate.p_domains) > 0
                     AND split_part(COALESCE(candidate.normalized_email, ''), '@', 2) = ANY (candidate.p_domains) THEN 'name_email_domain' END,
              CASE WHEN candidate.name_similarity >= $8 THEN 'similar_name' END
            ], NULL) AS signals
       FROM candidates candidate
       LEFT JOIN tenant.business_parties account ON account.organization_id = candidate.organization_id AND account.id = candidate.party_id
       LEFT JOIN public.users owner ON owner.id = candidate.owner_user_id
      ORDER BY (candidate.c_emails && candidate.p_emails OR candidate.c_phones && candidate.p_phones) DESC, candidate.name_similarity DESC, candidate.updated_at DESC
      LIMIT ${Number(limit) * 3}`,
    values,
  );
  const matches = rows
    .filter((row) => row.signals.length)
    .slice(0, Number(limit))
    .map((row) => {
      const strength = row.signals.some((signal) => STRONG.has(signal)) ? "exact" : "possible";
      const match = { id: row.id, signals: row.signals, strength, canOpen: row.can_open };
      if (!row.can_open) return match;
      return {
        ...match, code: row.contact_number, name: row.display_name || `${row.first_name} ${row.last_name ?? ""}`.trim(), jobTitle: row.designation,
        email: row.email, mobile: row.mobile, status: row.status, accountId: row.party_id, accountName: row.account_name, ownerName: row.owner_name,
      };
    })
    .sort((left, right) => (left.strength === right.strength ? 0 : left.strength === "exact" ? -1 : 1));
  return { matches, hasBlockingMatch: matches.some((match) => match.strength === "exact") };
}

// Refuses an obvious duplicate. `allowDuplicate` is the caller's explicit
// "this is a different person" confirmation.
export async function assertNoBlockingContactDuplicate(client, context, input, { excludeId = null, allowDuplicate = false } = {}) {
  const result = await findDuplicateContacts(client, context, input, { excludeId });
  if (result.hasBlockingMatch && !allowDuplicate)
    throw new CrmError(409, "A contact with this email or phone number already exists.", "CRM_CONTACT_DUPLICATE", { matches: result.matches });
  return result;
}
