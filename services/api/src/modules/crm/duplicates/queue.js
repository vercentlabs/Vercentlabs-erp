// The duplicate review queue: pairs of existing records that look like the
// same person or company. It catches what slipped in through imports,
// integrations and overrides. The queue is calculated from the records as
// they are now, so a pair disappears as soon as it is merged, one side is
// corrected, or it is marked "not duplicate".
//
// Pairs are found on values the database can match directly: email, mobile,
// GSTIN, website domain, exact normalized company name, and the same person
// name at the same company, or with no company on either side, when no email
// or mobile tells them apart (two leads that are only "Prasad"). Fuzzy
// matching belongs to the warning shown while a record is entered.
import { mergedSql, requireDuplicateReview } from "./decisions.js";
import { gradeMatch } from "./scoring.js";

const QUEUE_LIMIT = 200;

// A pair already reviewed and cleared.
const clearedSql = (typeA, a, typeB, b) => `EXISTS (SELECT 1 FROM tenant.crm_duplicate_decisions decision
  WHERE decision.organization_id = ${a}.organization_id AND decision.decision = 'not_duplicate'
    AND ((decision.record_type_a = '${typeA}' AND decision.record_id_a = ${a}.id AND decision.record_type_b = '${typeB}' AND decision.record_id_b = ${b}.id)
      OR (decision.record_type_a = '${typeB}' AND decision.record_id_a = ${b}.id AND decision.record_type_b = '${typeA}' AND decision.record_id_b = ${a}.id)))`;

const LEAD_COLUMNS = (alias, side) => `${alias}.id AS ${side}_id, ${alias}.code AS ${side}_code, COALESCE(${alias}.full_name, ${alias}.company_name, ${alias}.code) AS ${side}_name,
  ${alias}.company_name AS ${side}_detail, ${alias}.email AS ${side}_email, ${alias}.created_at AS ${side}_created_at, ${alias}_owner.full_name AS ${side}_owner`;
const CONTACT_COLUMNS = (alias, side) => `${alias}.id AS ${side}_id, ${alias}.contact_number AS ${side}_code, ${alias}.display_name AS ${side}_name,
  ${alias}_account.display_name AS ${side}_detail, ${alias}.email AS ${side}_email, ${alias}.created_at AS ${side}_created_at, ${alias}_owner.full_name AS ${side}_owner`;
const ACCOUNT_COLUMNS = (alias, side) => `${alias}.id AS ${side}_id, ${alias}.code AS ${side}_code, ${alias}.display_name AS ${side}_name,
  ${alias}.website AS ${side}_detail, ${alias}.email AS ${side}_email, ${alias}.created_at AS ${side}_created_at, ${alias}_owner.full_name AS ${side}_owner`;

const QUERIES = Object.freeze({
  lead_lead: {
    types: ["lead", "lead"],
    sql: `SELECT ${LEAD_COLUMNS("a", "a")}, ${LEAD_COLUMNS("b", "b")},
            array_remove(ARRAY[
              CASE WHEN a.normalized_email IS NOT NULL AND a.normalized_email = b.normalized_email THEN 'email' END,
              CASE WHEN a.normalized_mobile IS NOT NULL AND a.normalized_mobile = b.normalized_mobile THEN 'mobile' END,
              CASE WHEN a.normalized_name IS NOT NULL AND a.normalized_name = b.normalized_name AND a.normalized_company_name = b.normalized_company_name THEN 'name_company' END,
              CASE WHEN a.normalized_name IS NOT NULL AND a.normalized_name = b.normalized_name AND a.normalized_company_name IS NULL AND b.normalized_company_name IS NULL THEN 'name' END], NULL) AS signals
       FROM tenant.crm_leads a
       JOIN tenant.crm_leads b ON b.organization_id = a.organization_id AND a.id < b.id
        AND ((a.normalized_email IS NOT NULL AND a.normalized_email = b.normalized_email) OR (a.normalized_mobile IS NOT NULL AND a.normalized_mobile = b.normalized_mobile)
          -- the same person at the same company, or with no company on either side, and no email or mobile
          -- that tells them apart: a possible duplicate
          OR (a.normalized_name IS NOT NULL AND a.normalized_name = b.normalized_name AND a.normalized_company_name IS NOT DISTINCT FROM b.normalized_company_name
              AND NOT (a.normalized_email IS NOT NULL AND b.normalized_email IS NOT NULL AND a.normalized_email <> b.normalized_email)
              AND NOT (a.normalized_mobile IS NOT NULL AND b.normalized_mobile IS NOT NULL AND a.normalized_mobile <> b.normalized_mobile)))
       LEFT JOIN public.users a_owner ON a_owner.id = a.owner_user_id
       LEFT JOIN public.users b_owner ON b_owner.id = b.owner_user_id
      WHERE a.organization_id = $1 AND a.archived_at IS NULL AND b.archived_at IS NULL AND a.status <> 'converted' AND b.status <> 'converted'
        AND NOT ${mergedSql("lead", "a")} AND NOT ${mergedSql("lead", "b")} AND NOT ${clearedSql("lead", "a", "lead", "b")}
      ORDER BY GREATEST(a.created_at, b.created_at) DESC LIMIT ${QUEUE_LIMIT}`,
  },
  lead_contact: {
    types: ["lead", "contact"],
    sql: `SELECT ${LEAD_COLUMNS("a", "a")}, ${CONTACT_COLUMNS("b", "b")},
            array_remove(ARRAY[
              CASE WHEN a.normalized_email IS NOT NULL AND a.normalized_email = b.normalized_email THEN 'email' END,
              CASE WHEN a.normalized_mobile IS NOT NULL AND a.normalized_mobile = b.normalized_mobile THEN 'mobile' END], NULL) AS signals
       FROM tenant.crm_leads a
       JOIN tenant.contacts b ON b.organization_id = a.organization_id
        AND ((a.normalized_email IS NOT NULL AND a.normalized_email = b.normalized_email) OR (a.normalized_mobile IS NOT NULL AND a.normalized_mobile = b.normalized_mobile))
       LEFT JOIN public.users a_owner ON a_owner.id = a.owner_user_id
       LEFT JOIN public.users b_owner ON b_owner.id = b.owner_user_id
       LEFT JOIN tenant.business_parties b_account ON b_account.organization_id = b.organization_id AND b_account.id = b.party_id
      WHERE a.organization_id = $1 AND a.archived_at IS NULL AND a.status IN ('open', 'qualified') AND b.status <> 'archived'
        AND NOT ${mergedSql("lead", "a")} AND NOT ${mergedSql("contact", "b")} AND NOT ${clearedSql("lead", "a", "contact", "b")}
      ORDER BY a.created_at DESC LIMIT ${QUEUE_LIMIT}`,
  },
  contact_contact: {
    types: ["contact", "contact"],
    sql: `SELECT ${CONTACT_COLUMNS("a", "a")}, ${CONTACT_COLUMNS("b", "b")},
            array_remove(ARRAY[
              CASE WHEN a.normalized_email IS NOT NULL AND a.normalized_email = b.normalized_email THEN 'email' END,
              CASE WHEN a.normalized_mobile IS NOT NULL AND a.normalized_mobile = b.normalized_mobile THEN 'mobile' END], NULL) AS signals
       FROM tenant.contacts a
       JOIN tenant.contacts b ON b.organization_id = a.organization_id AND a.id < b.id
        AND ((a.normalized_email IS NOT NULL AND a.normalized_email = b.normalized_email) OR (a.normalized_mobile IS NOT NULL AND a.normalized_mobile = b.normalized_mobile))
       LEFT JOIN public.users a_owner ON a_owner.id = a.owner_user_id
       LEFT JOIN public.users b_owner ON b_owner.id = b.owner_user_id
       LEFT JOIN tenant.business_parties a_account ON a_account.organization_id = a.organization_id AND a_account.id = a.party_id
       LEFT JOIN tenant.business_parties b_account ON b_account.organization_id = b.organization_id AND b_account.id = b.party_id
      WHERE a.organization_id = $1 AND a.status <> 'archived' AND b.status <> 'archived'
        AND NOT ${mergedSql("contact", "a")} AND NOT ${mergedSql("contact", "b")} AND NOT ${clearedSql("contact", "a", "contact", "b")}
      ORDER BY GREATEST(a.created_at, b.created_at) DESC LIMIT ${QUEUE_LIMIT}`,
  },
  account_account: {
    types: ["account", "account"],
    sql: `SELECT ${ACCOUNT_COLUMNS("a", "a")}, ${ACCOUNT_COLUMNS("b", "b")},
            array_remove(ARRAY[
              CASE WHEN NULLIF(a.gstin, '') IS NOT NULL AND upper(a.gstin) = upper(b.gstin) THEN 'gstin' END,
              CASE WHEN a.normalized_company_name IS NOT NULL AND a.normalized_company_name = b.normalized_company_name THEN 'name' END,
              CASE WHEN a.website_domain IS NOT NULL AND a.website_domain = b.website_domain THEN 'website' END], NULL) AS signals
       FROM tenant.business_parties a
       JOIN tenant.business_parties b ON b.organization_id = a.organization_id AND a.id < b.id
        AND ((NULLIF(a.gstin, '') IS NOT NULL AND upper(a.gstin) = upper(b.gstin))
          OR (a.normalized_company_name IS NOT NULL AND a.normalized_company_name = b.normalized_company_name)
          OR (a.website_domain IS NOT NULL AND a.website_domain = b.website_domain))
       LEFT JOIN public.users a_owner ON a_owner.id = a.owner_user_id
       LEFT JOIN public.users b_owner ON b_owner.id = b.owner_user_id
      WHERE a.organization_id = $1 AND a.party_type <> 'supplier' AND b.party_type <> 'supplier' AND a.status <> 'archived' AND b.status <> 'archived'
        AND NOT ${mergedSql("account", "a")} AND NOT ${mergedSql("account", "b")} AND NOT ${clearedSql("account", "a", "account", "b")}
      ORDER BY GREATEST(a.created_at, b.created_at) DESC LIMIT ${QUEUE_LIMIT}`,
  },
});

export const DUPLICATE_QUEUE_TYPES = Object.freeze([
  { code: "lead_lead", label: "Lead and lead" },
  { code: "lead_contact", label: "Lead and contact" },
  { code: "contact_contact", label: "Contact and contact" },
  { code: "account_account", label: "Account and account" },
]);

const side = (row, prefix, type) => ({
  type, id: row[`${prefix}_id`], code: row[`${prefix}_code`], name: row[`${prefix}_name`], detail: row[`${prefix}_detail`], email: row[`${prefix}_email`],
  ownerName: row[`${prefix}_owner`] ?? null, createdAt: row[`${prefix}_created_at`],
});

// input: { type?: one of DUPLICATE_QUEUE_TYPES; omitted = all }
// Returns { pairs, counts }. Needs crm.duplicates.review, which is a
// manager's permission: the queue shows records across owners.
export async function listDuplicateQueue(client, context, input = {}) {
  requireDuplicateReview(context);
  const wanted = QUERIES[input.type] ? [input.type] : Object.keys(QUERIES);
  const pairs = [];
  const counts = {};
  for (const type of Object.keys(QUERIES)) {
    const query = QUERIES[type];
    const { rows } = await client.query(query.sql, [context.organizationId]);
    counts[type] = rows.length;
    if (!wanted.includes(type)) continue;
    for (const row of rows) {
      // A website shared without the same name is only a possible match.
      const grade = gradeMatch(query.types[0], row.signals);
      pairs.push({
        type,
        a: side(row, "a", query.types[0]),
        b: side(row, "b", query.types[1]),
        signals: row.signals,
        matchStrength: grade.matchStrength,
        score: grade.score,
        reasons: grade.reasons,
        // The same record type can be merged; a lead and a contact are resolved by converting or disqualifying the lead.
        canMerge: query.types[0] === query.types[1],
      });
    }
  }
  return { pairs, counts, limit: QUEUE_LIMIT };
}
