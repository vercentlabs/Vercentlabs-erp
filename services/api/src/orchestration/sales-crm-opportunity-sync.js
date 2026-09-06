// Despite the filename, this now covers every side effect that must run
// after Sales order confirmation/cancellation but can't live inside
// confirmSalesOrder/cancelSalesOrder itself: the CRM opportunity sync
// (genuinely cross-module) and commission accrual (same module, but
// pass1-operations.js and index.js can't import each other directly -
// pass1-operations.js already imports SalesError from index.js, so this
// orchestration layer, which imports from both without creating a cycle,
// is the correct home for that wiring too).
import { confirmSalesOrder, cancelSalesOrder } from "../modules/sales/index.js";
import { accrueSalesCommission } from "../modules/sales/pass1-operations.js";
import { moveOpportunityStage } from "../modules/crm/index.js";

function crmSyncContext(salesContext) {
  return {
    organizationId: salesContext.organizationId,
    userId: salesContext.userId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["crm.opportunities.manage", "crm.records.view_all"],
    roleSlugs: [],
  };
}

// accrueSalesCommission requires sales.settings.manage - the confirming rep
// won't usually hold that. Elevated, tenant-scoped internal step, same
// shape as crmSyncContext above.
function commissionAccrualContext(salesContext) {
  return {
    organizationId: salesContext.organizationId,
    userId: salesContext.userId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["sales.settings.manage"],
    roleSlugs: [],
  };
}

async function findWonStage(client, crmContext, opportunityId) {
  const opportunity = await client.query(
    `SELECT pipeline_id, status FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2`,
    [crmContext.organizationId, opportunityId],
  );
  if (!opportunity.rows[0] || opportunity.rows[0].status !== "open") return null;
  const stage = await client.query(
    `SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND is_won=true AND status='active' ORDER BY sequence LIMIT 1`,
    [crmContext.organizationId, opportunity.rows[0].pipeline_id],
  );
  if (!stage.rows[0]) return null;
  const reason = await client.query(
    `SELECT id FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND outcome_type IN ('won','both') AND status='active' ORDER BY (code='WON_OTHER') DESC,created_at LIMIT 1`,
    [crmContext.organizationId],
  );
  if (!reason.rows[0]) return null;
  return { stageId: stage.rows[0].id, outcomeReasonId: reason.rows[0].id };
}

async function findReopenStage(client, crmContext, opportunityId) {
  const opportunity = await client.query(
    `SELECT pipeline_id, status FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2`,
    [crmContext.organizationId, opportunityId],
  );
  if (!opportunity.rows[0] || opportunity.rows[0].status !== "won") return null;
  const stage = await client.query(
    `SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND is_won=false AND is_lost=false AND status='active' ORDER BY sequence LIMIT 1`,
    [crmContext.organizationId, opportunity.rows[0].pipeline_id],
  );
  return stage.rows[0]?.id || null;
}

// Closing/reopening a CRM opportunity from a Sales order event MUST go
// through CRM's own governed moveOpportunityStage (stage-history snapshot,
// outcome reason validation) rather than writing tenant.crm_opportunities
// directly - see the F042 gap-closing fix. A CRM-side misconfiguration
// (no won stage or no won reason configured for the pipeline) must never
// block the Sales order action itself, so this step is best-effort.
export async function confirmSalesOrderWithCrmSync(
  client,
  salesContext,
  orderId,
  options = {},
) {
  const result = await confirmSalesOrder(client, salesContext, orderId, options);
  if (result.sourceOpportunityId) {
    try {
      const crmContext = crmSyncContext(salesContext);
      const won = await findWonStage(client, crmContext, result.sourceOpportunityId);
      if (won) {
        await moveOpportunityStage(
          client,
          crmContext,
          result.sourceOpportunityId,
          won.stageId,
          `Sales order ${orderId} confirmed.`,
          { outcomeReasonId: won.outcomeReasonId },
        );
      }
    } catch {
      // Best-effort - order confirmation already succeeded and must stand.
    }
  }
  // F057 gap: accrueSalesCommission (a real, correct calculation engine -
  // rule precedence, net_sales/gross_margin basis, idempotent
  // upsert-by-natural-key) was only ever reachable via a manual action,
  // with nothing triggering it automatically. Order confirmation is the
  // natural trigger point (the same moment the CRM opportunity closes).
  // Most orders have no applicable commission rule configured at all -
  // that's an expected, common outcome, not a failure, so this is
  // unconditionally best-effort just like the CRM sync above.
  try {
    await accrueSalesCommission(client, commissionAccrualContext(salesContext), {
      salesOrderId: orderId,
    });
  } catch {
    // Best-effort - no applicable commission rule is a normal outcome, and
    // a commission-configuration issue must never block order confirmation.
  }
  return result;
}

export async function cancelSalesOrderWithCrmSync(
  client,
  salesContext,
  orderId,
  reason,
) {
  const result = await cancelSalesOrder(client, salesContext, orderId, reason);
  if (result.sourceOpportunityId) {
    try {
      const crmContext = crmSyncContext(salesContext);
      const reopenStageId = await findReopenStage(
        client,
        crmContext,
        result.sourceOpportunityId,
      );
      if (reopenStageId) {
        await moveOpportunityStage(
          client,
          crmContext,
          result.sourceOpportunityId,
          reopenStageId,
          `Reopened: the Sales order that won this opportunity (${orderId}) was cancelled.`,
        );
      }
    } catch {
      // Best-effort - order cancellation already succeeded and must stand.
    }
  }
  return result;
}
