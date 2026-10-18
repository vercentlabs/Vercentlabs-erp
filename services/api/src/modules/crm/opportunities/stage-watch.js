// Stage time limits (CRM plan 5.1). A stage may say how many days a deal should stay in it (crm_opportunity_stage_sla_policies). An
// open deal that stays longer is flagged on the board, and its owner is told once; at twice the limit its owner's manager is told once.
// Both notices re-arm when the deal moves to another stage. Run with the CRM watch on every worker tick; each notice is stamped in the
// statement that claims its row (FOR UPDATE SKIP LOCKED), so an overlapping tick never notifies twice.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { MANAGER } from "../leads/response-watch.js";

const BATCH = 200;
const dayText = (days) => `${days} ${days === 1 ? "day" : "days"}`;

// Open deals past `factor` × their stage's limit. `$1` organization; the stamp column must be older than the stage entry.
const OVER_LIMIT = (factor, stamp) => `deal.organization_id = $1 AND deal.status = 'open' AND deal.archived_at IS NULL AND deal.owner_user_id IS NOT NULL
  AND (deal.${stamp} IS NULL OR deal.${stamp} < deal.stage_entered_at)
  AND EXISTS (SELECT 1 FROM tenant.crm_opportunity_stage_sla_policies sla WHERE sla.organization_id = deal.organization_id AND sla.stage_id = deal.stage_id
               AND sla.status = 'active' AND deal.stage_entered_at < now() - make_interval(days => sla.maximum_days * ${factor}))`;

export async function runOpportunityStageWatch(client, organizationId) {
  const alerts = (await client.query(
    `WITH claimed AS (
       UPDATE tenant.crm_opportunities SET stage_overdue_alerted_at = now()
        WHERE id IN (SELECT deal.id FROM tenant.crm_opportunities deal WHERE ${OVER_LIMIT(1, "stage_overdue_alerted_at")} ORDER BY deal.stage_entered_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, code, name, owner_user_id, stage_id, stage_entered_at)
     SELECT claimed.*, stage.name AS stage_name, sla.maximum_days
       FROM claimed
       JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = $1 AND stage.id = claimed.stage_id
       JOIN tenant.crm_opportunity_stage_sla_policies sla ON sla.organization_id = $1 AND sla.stage_id = claimed.stage_id AND sla.status = 'active'`,
    [organizationId])).rows;
  for (const deal of alerts)
    await createNotification(client, {
      organizationId, userId: deal.owner_user_id, category: "crm_opportunity_stage_overdue", title: `${deal.name} is over its time in ${deal.stage_name}`,
      message: `${deal.code} has been in ${deal.stage_name} longer than its ${dayText(deal.maximum_days)}. Move it on, or plan the next step.`,
      href: `/crm/opportunities/${deal.id}`, entityType: "crm.opportunity", entityId: deal.id,
    });

  const escalations = (await client.query(
    `WITH claimed AS (
       UPDATE tenant.crm_opportunities SET stage_overdue_escalated_at = now()
        WHERE id IN (SELECT deal.id FROM tenant.crm_opportunities deal WHERE ${OVER_LIMIT(2, "stage_overdue_escalated_at")} ORDER BY deal.stage_entered_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, code, name, owner_user_id, team_id, stage_id)
     SELECT claimed.*, stage.name AS stage_name, sla.maximum_days, owner.full_name AS owner_name, ${MANAGER("claimed.team_id", "claimed.owner_user_id")} AS manager_id
       FROM claimed
       JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = $1 AND stage.id = claimed.stage_id
       JOIN tenant.crm_opportunity_stage_sla_policies sla ON sla.organization_id = $1 AND sla.stage_id = claimed.stage_id AND sla.status = 'active'
       LEFT JOIN users owner ON owner.id = claimed.owner_user_id`,
    [organizationId])).rows;
  for (const deal of escalations) {
    if (!deal.manager_id) continue;
    await createNotification(client, {
      organizationId, userId: deal.manager_id, category: "crm_opportunity_stage_escalation", title: `Stuck deal: ${deal.name}`,
      message: `${deal.code}, owned by ${deal.owner_name ?? "a team member"}, has been in ${deal.stage_name} for more than twice its ${dayText(deal.maximum_days)}.`,
      href: `/crm/opportunities/${deal.id}`, entityType: "crm.opportunity", entityId: deal.id,
    });
  }
  return { stageOverdue: alerts.length, stageEscalated: escalations.length };
}
