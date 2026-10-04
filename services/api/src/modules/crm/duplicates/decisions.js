// "These two are not duplicates": a reviewed pair the system should stop
// warning about. ABC India Pvt Ltd and ABC India Foundation may share a
// website and still be two organizations.
import { CrmError } from "../data-management/errors.js";
import { DUPLICATE_PERMISSIONS, DUPLICATE_RECORD_TYPES } from "./policy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();

export function requireDuplicateReview(context) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes(DUPLICATE_PERMISSIONS.review))
    throw new CrmError(403, "You do not have permission to review duplicates.", "PERMISSION_DENIED");
}

function recordRef(type, id) {
  if (!DUPLICATE_RECORD_TYPES.includes(type) || !UUID.test(String(id ?? ""))) throw new CrmError(400, "Choose two records.", "CRM_DUPLICATE_VALIDATION");
  return { type, id: String(id) };
}

const TABLES = Object.freeze({ lead: "tenant.crm_leads", contact: "tenant.contacts", account: "tenant.business_parties" });

// input: { recordTypeA, recordIdA, recordTypeB, recordIdB, reason? }
export async function markNotDuplicate(client, context, input = {}) {
  requireDuplicateReview(context);
  const a = recordRef(input.recordTypeA, input.recordIdA);
  const b = recordRef(input.recordTypeB, input.recordIdB);
  if (a.type === b.type && a.id === b.id) throw new CrmError(400, "Choose two different records.", "CRM_DUPLICATE_VALIDATION");
  // Both records must belong to this organization (row-level security also enforces it).
  for (const ref of [a, b]) {
    const found = await client.query(`SELECT 1 FROM ${TABLES[ref.type]} WHERE organization_id = $1 AND id = $2`, [context.organizationId, ref.id]);
    if (!found.rows[0]) throw new CrmError(404, "Record not found.", "CRM_DUPLICATE_RECORD_NOT_FOUND");
  }
  const { rowCount } = await client.query(
    `INSERT INTO tenant.crm_duplicate_decisions (organization_id, decision, record_type_a, record_id_a, record_type_b, record_id_b, reason, decided_by)
     VALUES ($1, 'not_duplicate', $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [context.organizationId, a.type, a.id, b.type, b.id, text(input.reason).slice(0, 500) || null, context.userId ?? null],
  );
  return { marked: rowCount > 0 };
}

// Withdraws the exclusion, so the pair is reported again.
export async function unmarkNotDuplicate(client, context, input = {}) {
  requireDuplicateReview(context);
  const a = recordRef(input.recordTypeA, input.recordIdA);
  const b = recordRef(input.recordTypeB, input.recordIdB);
  const { rowCount } = await client.query(
    `DELETE FROM tenant.crm_duplicate_decisions
      WHERE organization_id = $1 AND decision = 'not_duplicate'
        AND ((record_type_a = $2 AND record_id_a = $3 AND record_type_b = $4 AND record_id_b = $5)
          OR (record_type_a = $4 AND record_id_a = $5 AND record_type_b = $2 AND record_id_b = $3))`,
    [context.organizationId, a.type, a.id, b.type, b.id],
  );
  return { removed: rowCount > 0 };
}

// "type:id" of every record marked as not a duplicate of the given one.
export async function notDuplicateKeys(client, context, recordType, recordId) {
  if (!UUID.test(String(recordId ?? ""))) return new Set();
  const { rows } = await client.query(
    `SELECT CASE WHEN record_type_a = $2 AND record_id_a = $3 THEN record_type_b || ':' || record_id_b::text ELSE record_type_a || ':' || record_id_a::text END AS key
       FROM tenant.crm_duplicate_decisions
      WHERE organization_id = $1 AND decision = 'not_duplicate'
        AND ((record_type_a = $2 AND record_id_a = $3) OR (record_type_b = $2 AND record_id_b = $3))`,
    [context.organizationId, recordType, recordId],
  );
  return new Set(rows.map((row) => row.key));
}

// Drops matches the user has already reviewed and cleared for this record.
export async function withoutClearedPairs(client, context, recordType, recordId, matches, kindOf = () => recordType) {
  if (!recordId || !matches.length) return matches;
  const cleared = await notDuplicateKeys(client, context, recordType, recordId);
  return cleared.size ? matches.filter((match) => !cleared.has(`${kindOf(match)}:${match.id}`)) : matches;
}

// SQL true when `alias` (a row of the given type) was merged into another record.
export const mergedSql = (recordType, alias) => (recordType === "lead" ? `${alias}.merged_into_lead_id IS NOT NULL` : `EXISTS (SELECT 1 FROM tenant.crm_entity_merge_aliases merged
  WHERE merged.organization_id = ${alias}.organization_id AND merged.entity_type = '${recordType}' AND merged.source_entity_id = ${alias}.id)`);
