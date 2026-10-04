// Data Quality, beyond the queue of potential duplicates: what was already
// decided. Merged records (which record was folded into which, by whom), the
// pairs reviewed as "not duplicates", and the detection rules in plain words.
import { requireDuplicateReview } from "./decisions.js";
import { DUPLICATE_SIGNALS } from "./scoring.js";

const NAME_SQL = (type, id) => `CASE ${type}
  WHEN 'lead' THEN (SELECT COALESCE(l.full_name, l.company_name, l.code) FROM tenant.crm_leads l WHERE l.id = ${id})
  WHEN 'contact' THEN (SELECT c.display_name FROM tenant.contacts c WHERE c.id = ${id})
  ELSE (SELECT p.display_name FROM tenant.business_parties p WHERE p.id = ${id}) END`;
const HREFS = Object.freeze({ lead: "/crm/leads", contact: "/crm/contacts", account: "/crm/accounts" });
const record = (type, id, name) => ({ type, id, name: name ?? "Record", href: `${HREFS[type] ?? HREFS.account}/${id}` });

// The latest merges: the record that was folded in, and the one that was kept.
export async function listMergedRecords(client, context, { limit = 100 } = {}) {
  requireDuplicateReview(context);
  const { rows } = await client.query(
    `SELECT * FROM (
       SELECT lead.id AS key, 'lead'::text AS type, lead.id AS merged_id, COALESCE(lead.full_name, lead.company_name, lead.code) AS merged_name,
              lead.merged_into_lead_id AS kept_id, COALESCE(kept.full_name, kept.company_name, kept.code) AS kept_name,
              lead.disqualified_at AS merged_at, merger.full_name AS merged_by_name
         FROM tenant.crm_leads lead
         JOIN tenant.crm_leads kept ON kept.organization_id = lead.organization_id AND kept.id = lead.merged_into_lead_id
         LEFT JOIN public.users merger ON merger.id = lead.disqualified_by
        WHERE lead.organization_id = $1 AND lead.merged_into_lead_id IS NOT NULL
       UNION ALL
       SELECT alias.id AS key, CASE WHEN alias.entity_type IN ('party', 'account') THEN 'account' ELSE alias.entity_type END AS type, alias.source_entity_id AS merged_id,
              ${NAME_SQL("CASE WHEN alias.entity_type IN ('party', 'account') THEN 'account' ELSE alias.entity_type END", "alias.source_entity_id")} AS merged_name,
              alias.survivor_entity_id AS kept_id,
              ${NAME_SQL("CASE WHEN alias.entity_type IN ('party', 'account') THEN 'account' ELSE alias.entity_type END", "alias.survivor_entity_id")} AS kept_name,
              alias.merged_at, merger.full_name AS merged_by_name
         FROM tenant.crm_entity_merge_aliases alias
         LEFT JOIN public.users merger ON merger.id = alias.merged_by
        WHERE alias.organization_id = $1
     ) merged ORDER BY merged.merged_at DESC NULLS LAST LIMIT $2`,
    [context.organizationId, Math.min(200, Math.max(1, Number(limit) || 100))],
  );
  return rows.map((row) => ({
    id: row.key, type: row.type, merged: record(row.type, row.merged_id, row.merged_name), kept: record(row.type, row.kept_id, row.kept_name),
    mergedAt: row.merged_at, mergedByName: row.merged_by_name ?? null,
  }));
}

// Pairs reviewed and cleared: the system no longer reports them. Each can be put back for review.
export async function listNotDuplicates(client, context, { limit = 100 } = {}) {
  requireDuplicateReview(context);
  const { rows } = await client.query(
    `SELECT decision.id, decision.record_type_a, decision.record_id_a, decision.record_type_b, decision.record_id_b, decision.reason, decision.decided_at,
            decider.full_name AS decided_by_name,
            ${NAME_SQL("decision.record_type_a", "decision.record_id_a")} AS name_a, ${NAME_SQL("decision.record_type_b", "decision.record_id_b")} AS name_b
       FROM tenant.crm_duplicate_decisions decision
       LEFT JOIN public.users decider ON decider.id = decision.decided_by
      WHERE decision.organization_id = $1 AND decision.decision = 'not_duplicate'
      ORDER BY decision.decided_at DESC LIMIT $2`,
    [context.organizationId, Math.min(200, Math.max(1, Number(limit) || 100))],
  );
  return rows.map((row) => ({
    id: row.id, a: record(row.record_type_a, row.record_id_a, row.name_a), b: record(row.record_type_b, row.record_id_b, row.name_b),
    reason: row.reason, decidedAt: row.decided_at, decidedByName: row.decided_by_name ?? null,
  }));
}

// The detection rules, as the settings page shows them: what is compared and how strong a match it makes.
export function getDuplicateRules() {
  const rules = (catalogue) => Object.entries(catalogue)
    .map(([signal, rule]) => ({ signal, label: rule.label, strength: rule.strong ? "strong" : "possible", weight: rule.weight }))
    .sort((left, right) => right.weight - left.weight)
    .map(({ weight: _weight, ...rule }) => rule);
  return {
    people: { label: "Leads and contacts", rules: rules(DUPLICATE_SIGNALS.lead) },
    companies: { label: "Accounts", rules: rules(DUPLICATE_SIGNALS.account) },
    behaviour: {
      strong: "A strong match stops the save: use the existing record, or (with permission) create anyway with a reason.",
      possible: "A possible match is a warning: the user can continue.",
    },
  };
}
