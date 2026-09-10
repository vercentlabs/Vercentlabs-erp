import "server-only";

import {
  getCrmOptions,
  getCrmRecord,
  getOpportunityRevenueWorkspace,
  listCrmRecords,
  listOpportunityCompetitors,
  listOpportunityItems,
  listOpportunityStageAges,
  listOpportunityTeamMembers,
} from "@vercentlabs/api";
import { canViewSensitiveLeadContent, serializedClient } from "./lead-detail-data";

type CrmClient = Parameters<typeof getCrmRecord>[0];
type CrmContext = Parameters<typeof getCrmRecord>[1];
type Row = Record<string, unknown>;

// Prompts 1-5 integrity closeout (blocker B): the canonical, single
// server-side Opportunity-detail projection — the Opportunity's own
// analogue of getLeadDetailData (./lead-detail-data.ts). Before this, web
// (crm/opportunities/[id]/page.tsx) and mobile (api/mobile/v1/crm/
// [resource]/[id]/route.ts) each independently re-derived which related
// panels required which permission, which is exactly how they drifted:
// mobile's own copy only ever fetched 5 of the ~14 related collections and
// applied its own separately-written sensitive-content gate. Both callers
// now go through this one function, so a future authorization change only
// has one place to make it — see getOpportunityDetailData below.
//
// Sales quotation visibility is a genuinely separate, cross-module
// permission (crm.view on the Opportunity does not imply any Sales-side
// read access) — kept as its own exported check so callers that only need
// the boolean (e.g. a "Create quotation" action gate) don't have to fetch
// the whole detail projection.
export function canSeeOpportunitySalesQuotations(context: CrmContext) {
  return (
    context.roleSlugs?.includes("organization_owner") ||
    context.permissions?.includes("sales.view")
  );
}

// Communication content (subject/body/recipients) uses the same
// crm.leads.view_sensitive permission regardless of parent record type
// (Lead or Opportunity) — this is the CRM_PERMISSION_MATRIX.md-documented
// "separate sensitive-content permission still applies" rule, and
// getLeadDetailData already implements exactly this check; reused verbatim
// rather than redefining an equivalent function under a different name.
export const canSeeOpportunitySensitiveContent = canViewSensitiveLeadContent;

// F018 closeout — the same private-to-sender communication-visibility
// override every other CRM domain module in this codebase carries locally
// (index.js's recordScope, timeline.js, lead-detail-data.ts).
function canViewAllCrmRecords(context: CrmContext) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes("crm.records.view_all"));
}

export async function getOpportunityDetailData(
  client: CrmClient,
  context: CrmContext,
  id: string,
) {
  // §E2E closeout: this function fans out ~14 concurrent client.query()
  // calls in the Promise.all below over a SINGLE tenantTransaction
  // PoolClient (one physical connection) — pg's Client does not safely
  // support overlapping un-awaited queries on one connection (the
  // "Calling client.query() when the client is already executing a
  // query is deprecated" warning), and this page's own `catch {
  // notFound() }` silently swallowed the resulting failure into a bare
  // 404 with no error surfaced anywhere. getLeadDetailData was already
  // fixed for the exact same hazard via serializedClient; reused here
  // rather than re-deriving an equivalent fix.
  const db = serializedClient(client);
  // getCrmRecord() is the single place Opportunity record-scope
  // authorization (organization/company/branch/team/owner) is enforced —
  // this throws (404, out of scope) before any related-panel query runs,
  // for both callers, exactly like getLeadDetailData's own first call.
  const opportunity = await getCrmRecord(db, context, "opportunities", id);
  const canSeeSensitiveContent = canSeeOpportunitySensitiveContent(context);
  const canSeeSalesQuotations = canSeeOpportunitySalesQuotations(context);
  const emptyRows: ReturnType<CrmClient["query"]> = Promise.resolve({
    rows: [],
    rowCount: 0,
  });

  const [
    options,
    history,
    probabilityHistory,
    activities,
    communications,
    items,
    team,
    competitors,
    risks,
    committees,
    revenueWorkspace,
    quotations,
    stageAges,
    allCompetitorsResult,
  ] = await Promise.all([
    getCrmOptions(db, context),
    db.query(
      `SELECT h.*,fs.name AS from_stage,ts.name AS to_stage,u.full_name AS changed_by_name FROM tenant.crm_opportunity_stage_history h LEFT JOIN tenant.crm_pipeline_stages fs ON fs.id=h.from_stage_id LEFT JOIN tenant.crm_pipeline_stages ts ON ts.id=h.to_stage_id LEFT JOIN public.users u ON u.id=h.changed_by WHERE h.organization_id=$1 AND h.opportunity_id=$2 ORDER BY h.changed_at DESC LIMIT 100`,
      [context.organizationId, id],
    ),
    db.query(
      `SELECT h.*,u.full_name AS changed_by_name FROM tenant.crm_opportunity_probability_history h LEFT JOIN public.users u ON u.id=h.changed_by WHERE h.organization_id=$1 AND h.opportunity_id=$2 ORDER BY h.changed_at DESC LIMIT 100`,
      [context.organizationId, id],
    ),
    // §"Opportunity ungated-activities divergence" (Prompt 6, CRM-VNEXT-129):
    // this query had NO sensitive-content gate at all — unlike Lead's own
    // equivalent (getLeadDetailData's `activities` query) and unlike
    // `communications` right below it in this same function, which was
    // already correctly gated. Any caller who could merely view the
    // Opportunity (passed getCrmRecord above) could read every linked
    // Call/Meeting/Task/Follow-up subject/detail — a real, unguarded
    // divergence from Lead's own equivalent projection, not a stylistic
    // difference.
    canSeeSensitiveContent
      ? db.query(
          `SELECT * FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2 ORDER BY COALESCE(completed_at,due_at,created_at) DESC LIMIT 100`,
          [context.organizationId, id],
        )
      : emptyRows,
    // F018 closeout — this query never applied the private-visibility
    // predicate the generic resource route (recordScope) and
    // getCommunicationTimeline already enforce.
    canSeeSensitiveContent
      ? db.query(
          `SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND opportunity_id=$2 AND (visibility<>'private' OR created_by=$3 OR $4) ORDER BY occurred_at DESC LIMIT 100`,
          [context.organizationId, id, context.userId, canViewAllCrmRecords(context)],
        )
      : emptyRows,
    listOpportunityItems(db, context, id),
    listOpportunityTeamMembers(db, context, id),
    listOpportunityCompetitors(db, context, id),
    listCrmRecords(db, context, "deal-risks", { opportunityId: id, status: "all", limit: 100 }),
    listCrmRecords(db, context, "buying-committees", { opportunityId: id, status: "all", limit: 5 }),
    getOpportunityRevenueWorkspace(db, context, id).catch(() => null),
    canSeeSalesQuotations
      ? db.query(
          `SELECT id,quotation_number,lifecycle_status,created_at FROM tenant.sales_quotations WHERE organization_id=$1 AND source_opportunity_id=$2 ORDER BY created_at DESC LIMIT 20`,
          [context.organizationId, id],
        )
      : emptyRows,
    listOpportunityStageAges(db, context, String(opportunity.pipelineId)),
    listCrmRecords(db, context, "competitors", { status: "active", limit: 200 }),
  ]);

  const committee = (committees as { rows: Row[] }).rows[0] || null;
  const committeeMembers = committee
    ? await listCrmRecords(db, context, "buying-committee-members", {
        committeeId: String(committee.id),
        status: "all",
        limit: 100,
      })
    : { rows: [] as Row[] };

  return {
    opportunity,
    canSeeSensitiveContent,
    canSeeSalesQuotations,
    options,
    history: history.rows,
    probabilityHistory: probabilityHistory.rows,
    activities: activities.rows,
    communications: communications.rows,
    items: items as unknown as Row[],
    team: team as unknown as Row[],
    competitors: competitors as unknown as Row[],
    risks: (risks as { rows: Row[] }).rows,
    committees: (committees as { rows: Row[] }).rows,
    committeeMembers: committeeMembers.rows,
    actionPlan: (revenueWorkspace?.actionPlan as Row | undefined) ?? null,
    actionPlanEvaluation: (revenueWorkspace?.actionPlanEvaluation as Row | undefined) ?? null,
    winLossReview: (revenueWorkspace?.winLossReview as Row | undefined) ?? null,
    quotations: quotations.rows,
    stageAge: stageAges[id] ?? null,
    allCompetitors: (allCompetitorsResult as { rows: Row[] }).rows,
  };
}

export type OpportunityDetailData = Awaited<ReturnType<typeof getOpportunityDetailData>>;
