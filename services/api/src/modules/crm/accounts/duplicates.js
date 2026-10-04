// Duplicate company detection, used by manual creation, editing, import,
// lead conversion and customer creation.
//
// Strong matches (the save is refused unless overridden):
//   the same GSTIN, the same normalized company or legal name, or the same
//   website domain together with a similar name
// Possible matches (a warning only):
//   the same website domain alone (two legal entities can share a site), a
//   similar name, or a related name at the same city, phone or email domain
//
// Archived accounts are matched too, so an existing company is restored
// rather than recreated; accounts merged into another are not. A customer is
// the same row as its account, so a Customer Master is matched here as well.
//
// Names are normalized in the database (tenant.crm_normalize_company_name),
// so "ABC Pvt. Ltd." and "ABC Private Limited" are the same name.
import { mergedSql, withoutClearedPairs } from "../duplicates/decisions.js";
import { normalizeCompanyName, normalizeDomain, normalizeGstin } from "../duplicates/normalize.js";
import { enforceDuplicatePolicy, lockDuplicateKeys } from "../duplicates/policy.js";
import { gradeMatch, sortMatches } from "../duplicates/scoring.js";
import { accountScopeSql } from "./access.js";
import { CRM_ACCOUNT_PARTY_SQL } from "./constants.js";
import { isUuid } from "./validation.js";

// A shared mailbox domain says nothing about the company.
const FREE_EMAIL_DOMAINS = ["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com",
  "rediffmail.com", "protonmail.com", "proton.me", "aol.com", "zoho.com", "yandex.com", "msn.com"];
const SIMILAR = 0.6;
const RELATED = 0.35;

const text = (value) => String(value ?? "").trim();

// input: { displayName, legalName, website, email, phone, gstin, city }
// Returns { matches, hasBlockingMatch }. A match the caller cannot open is
// reported without its details.
export async function findDuplicateAccounts(client, context, input = {}, { excludeId = null, limit = 10 } = {}) {
  const name = text(input.displayName);
  const legalName = text(input.legalName);
  const website = text(input.website);
  const email = text(input.email);
  const phone = text(input.phone);
  const gstin = text(input.gstin).toUpperCase();
  const city = text(input.city);
  if (!name && !legalName && !website && !gstin) return { matches: [], hasBlockingMatch: false };

  const values = [context.organizationId, name || null, legalName || null, website || null, email || null, phone || null, gstin || null, city || null,
    FREE_EMAIL_DOMAINS, isUuid(excludeId) ? excludeId : null, SIMILAR, RELATED];
  // Evaluated in the outer SELECT, where the row is `candidate`.
  const visible = accountScopeSql(context, values, "candidate");
  const { rows } = await client.query(
    `WITH probe AS (
       SELECT tenant.crm_normalize_company_name($2) AS p_name,
              tenant.crm_normalize_company_name($3) AS p_legal_name,
              tenant.crm_web_domain($4) AS p_domain,
              CASE WHEN tenant.crm_email_domain($5) = ANY ($9::text[]) THEN NULL ELSE tenant.crm_email_domain($5) END AS p_email_domain,
              tenant.crm_normalize_phone($6) AS p_phone,
              NULLIF($7, '') AS p_gstin,
              lower(NULLIF(btrim($8), '')) AS p_city),
     candidates AS (
       SELECT account.*, probe.*,
              GREATEST(similarity(COALESCE(account.normalized_company_name, ''), COALESCE(probe.p_name, probe.p_legal_name, '')),
                       similarity(COALESCE(account.normalized_legal_company_name, ''), COALESCE(probe.p_legal_name, probe.p_name, ''))) AS name_similarity
         FROM tenant.business_parties account CROSS JOIN probe
        WHERE account.organization_id = $1 AND ${CRM_ACCOUNT_PARTY_SQL("account")} AND NOT ${mergedSql("account", "account")}
          AND ($10::uuid IS NULL OR account.id <> $10)
          AND ((probe.p_domain IS NOT NULL AND account.website_domain = probe.p_domain)
            OR (probe.p_gstin IS NOT NULL AND upper(account.gstin) = probe.p_gstin)
            OR account.normalized_company_name IN (probe.p_name, probe.p_legal_name)
            OR account.normalized_legal_company_name IN (probe.p_name, probe.p_legal_name)
            OR account.normalized_company_name % COALESCE(probe.p_name, probe.p_legal_name))
     )
     SELECT candidate.id, candidate.code, candidate.display_name, candidate.legal_name, candidate.website, candidate.account_type, candidate.status,
            candidate.customer_number, owner.full_name AS owner_name, address.city AS address_city, (true${visible}) AS can_open,
            array_remove(ARRAY[
              CASE WHEN candidate.p_domain IS NOT NULL AND candidate.website_domain = candidate.p_domain
                   THEN (CASE WHEN candidate.name_similarity >= $11 THEN 'website_name' ELSE 'website' END) END,
              CASE WHEN candidate.p_gstin IS NOT NULL AND upper(candidate.gstin) = candidate.p_gstin THEN 'gstin' END,
              CASE WHEN candidate.normalized_company_name IN (candidate.p_name, candidate.p_legal_name)
                     OR candidate.normalized_legal_company_name IN (candidate.p_name, candidate.p_legal_name) THEN 'name' END,
              CASE WHEN candidate.name_similarity >= $11 THEN 'similar_name' END,
              CASE WHEN candidate.name_similarity >= $12 AND candidate.p_city IS NOT NULL AND lower(address.city) = candidate.p_city THEN 'name_city' END,
              CASE WHEN candidate.name_similarity >= $12 AND candidate.p_phone IS NOT NULL
                    AND candidate.p_phone IN (tenant.crm_normalize_phone(candidate.phone), tenant.crm_normalize_phone(candidate.secondary_phone)) THEN 'name_phone' END,
              CASE WHEN candidate.name_similarity >= $12 AND candidate.p_email_domain IS NOT NULL
                    AND candidate.p_email_domain IN (candidate.email_domain, candidate.website_domain) THEN 'name_email_domain' END
            ], NULL) AS signals
       FROM candidates candidate
       LEFT JOIN public.users owner ON owner.id = candidate.owner_user_id
       LEFT JOIN LATERAL (
         SELECT a.city FROM tenant.addresses a WHERE a.organization_id = candidate.organization_id AND a.party_id = candidate.id AND a.status = 'active'
          ORDER BY a.is_default_billing DESC, a.created_at LIMIT 1) address ON true
      ORDER BY candidate.name_similarity DESC, candidate.updated_at DESC
      LIMIT ${Number(limit) * 3}`,
    values,
  );
  const matches = rows
    .filter((row) => row.signals.length)
    .slice(0, Number(limit))
    .map((row) => {
      const match = { kind: "account", id: row.id, signals: row.signals, ...gradeMatch("account", row.signals), canOpen: row.can_open };
      if (!row.can_open) return match;
      return {
        ...match, code: row.code, name: row.display_name, legalName: row.legal_name, website: row.website, city: row.address_city,
        accountType: row.account_type, status: row.status, isArchived: row.status === "archived", isCustomer: Boolean(row.customer_number), customerNumber: row.customer_number, ownerName: row.owner_name,
      };
    });
  // Pairs already reviewed and marked "not duplicate" are not reported again.
  const kept = await withoutClearedPairs(client, context, "account", isUuid(excludeId) ? excludeId : null, sortMatches(matches));
  return { matches: kept, hasBlockingMatch: kept.some((match) => match.strength === "exact") };
}

// The single duplicate check for saving an account. Refuses a strong
// duplicate unless the caller may override and says why (allowDuplicate +
// reason); the caller records the override against the saved account.
export async function assertNoBlockingAccountDuplicate(client, context, input, { excludeId = null, allowDuplicate = false, reason = null } = {}) {
  await lockDuplicateKeys(client, context, "company", [
    normalizeGstin(input.gstin), normalizeDomain(input.website), normalizeCompanyName(input.displayName), normalizeCompanyName(input.legalName),
  ]);
  const result = await findDuplicateAccounts(client, context, input, { excludeId });
  return enforceDuplicatePolicy(context, result, { allowDuplicate, reason, code: "CRM_ACCOUNT_DUPLICATE", message: "An account like this already exists." });
}
