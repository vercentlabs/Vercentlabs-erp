import Link from "next/link";
import { notFound } from "next/navigation";

import CrmOpportunityActions, { CrmOpportunityReopenAction } from "@/modules/crm/components/opportunity-actions";
import { getOpportunityDetailData } from "@/modules/crm/server/opportunity-detail-data";
import CrmOpportunityProbabilityAction from "@/modules/crm/components/opportunity-probability-action";
import OpportunityWorkspaceTabs from "@/modules/crm/opportunity-and-pipeline-governance/opportunity-workspace-tabs";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import {
  ActionLink,
  MetricCard,
  Record360Archetype,
  RecordHeader,
  StatusBadge,
  type StatusTone,
} from "@/shared/design";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

function nice(value: unknown) {
  return String(value ?? "—").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
function money(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: String(currency || "INR"), minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
}
function outcomeTone(status: unknown): StatusTone {
  const value = String(status || "");
  if (value === "won") return "success";
  if (value === "lost") return "warning";
  return "neutral";
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = crmContext(session);

  let data: Awaited<ReturnType<typeof getOpportunityDetailData>>;
  // Prompts 1-5 integrity closeout (blocker B): both the sensitive-content
  // gate (communications) and the cross-module Sales quotation-read gate
  // now live centrally in getOpportunityDetailData — this page no longer
  // derives either independently, so web and mobile can never drift again.
  try {
    data = await tenantTransaction(context.organizationId, (client) =>
      getOpportunityDetailData(client, context, id),
    );
  } catch (error) {
    // §E2E closeout: this used to swallow the real error into a bare 404
    // with zero trace anywhere — a genuine data-loading bug (unrelated
    // concurrency hazard, fixed in getOpportunityDetailData) was
    // indistinguishable from "record does not exist / out of scope" for
    // weeks. Logging first costs nothing and would have caught it sooner.
    console.error("Opportunity detail page failed to load", id, error);
    notFound();
  }

  // Round-trip through JSON, matching every other prop below — the raw
  // record.updatedAt from getCrmRecord is a native pg Date object, and
  // String(dateObject) produces a non-ISO string ("Wed Sep 09 2026 ...")
  // that fails the API's z.string().datetime({offset:true}) expectedUpdatedAt
  // check. Real bug found this prompt: every UI-driven probability override
  // and stage move from this 360 page (CrmOpportunityProbabilityAction,
  // CrmOpportunityActions, CrmOpportunityReopenAction all read
  // String(record.updatedAt)) silently 400'd on submit.
  const record = JSON.parse(JSON.stringify(data.opportunity)) as Row;
  const probability = Number(record.probability || 0);
  const amount = Number(record.amount || 0);
  const expectedRevenue = Number(record.expectedRevenue ?? (amount * Math.max(0, Math.min(100, probability)) / 100));
  const stages = (data.options.stages || [])
    .filter((stage) => String(stage.pipelineId) === String(record.pipelineId))
    .map((stage) => ({
      id: String(stage.id),
      name: String(stage.name),
      isWon: Boolean(stage.isWon),
      isLost: Boolean(stage.isLost),
      probability: Number(stage.probability || 0),
    }));
  const outcomeReasons = (data.options.lostReasons || []).map((reason) => ({
    id: String(reason.id),
    name: String(reason.name),
    outcomeType: String(reason.outcomeType || "lost") as "won" | "lost" | "both",
  }));
  const outcomeReason = outcomeReasons.find((reason) => reason.id === String(record.outcomeReasonId || record.lostReasonId || ""));
  const canManage = hasPermission(session, PERMISSIONS.crmOpportunitiesManage);
  // Deal risks and the buying committee are separately-permissioned generic
  // CRM resources (crm.revenue.manage / crm.accounts.manage respectively,
  // not crm.opportunities.manage) — gate those two sections on their own
  // real requirement so the UI never offers an action that would 403.
  const canManageRisks = hasPermission(session, PERMISSIONS.crmRevenueManage);
  const canManageStakeholders = hasPermission(session, PERMISSIONS.crmAccountsManage);
  const currentStage = stages.find((stage) => stage.id === String(record.stageId));

  return (
    <Record360Archetype className="crm-record-page crm-opportunity-page">
      <Link className="crm-record-back" href="/crm/opportunities">← Opportunities</Link>
      <RecordHeader
        eyebrow={`Opportunity · ${String(record.code || "")}`}
        title={String(record.name || "Opportunity")}
        subtitle={String(record.nextStep || record.description || "Manage the next commercial action and expected close.")}
        status={
          <>
            <StatusBadge tone={outcomeTone(record.status)}>{nice(record.status)}</StatusBadge>
            {data.stageAge && data.stageAge.status !== "unknown" ? (
              <StatusBadge tone={data.stageAge.status === "breached" ? "danger" : data.stageAge.status === "warning" ? "warning" : "neutral"}>
                {String(data.stageAge.ageDays)}d in stage
              </StatusBadge>
            ) : null}
          </>
        }
        actions={
          <>
            {canManage ? (
              <ActionLink href={`/crm/opportunities?edit=${encodeURIComponent(id)}`}>
                Edit
              </ActionLink>
            ) : null}
            {hasPermission(session, PERMISSIONS.salesQuotationCreate) && record.partyId ? (
              <ActionLink tone="primary" href={`/sales/quotations/new?opportunityId=${id}`}>
                Create quotation
              </ActionLink>
            ) : null}
          </>
        }
      />

      <section className="crm-record-metrics" aria-label="Opportunity commercial summary">
        <MetricCard label="Amount" value={money(amount, record.currencyCode)} />
        <MetricCard label="Probability" value={`${probability}%`} />
        <MetricCard
          label="Expected revenue"
          value={money(expectedRevenue, record.currencyCode)}
        />
        <MetricCard
          label="Expected close"
          value={
            record.expectedCloseDate
              ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                  new Date(String(record.expectedCloseDate)),
                )
              : "—"
          }
        />
      </section>

      {canManage && !["won", "lost", "archived"].includes(String(record.status)) ? (
        <>
        <CrmOpportunityProbabilityAction id={id} probability={probability} amount={amount} expectedRevenue={expectedRevenue} currencyCode={String(record.currencyCode || "INR")} updatedAt={String(record.updatedAt)} stageProbability={currentStage?.probability ?? null} />
        <CrmOpportunityActions id={id} stageId={String(record.stageId)} updatedAt={String(record.updatedAt)} stages={stages} outcomeReasons={outcomeReasons} />
        </>
      ) : null}

      {canManage && ["won", "lost"].includes(String(record.status)) ? (
        <CrmOpportunityReopenAction id={id} status={String(record.status)} stageId={String(record.stageId)} updatedAt={String(record.updatedAt)} stages={stages} />
      ) : null}

      {["won", "lost"].includes(String(record.status)) ? (
        <section className="crm-outcome-banner">
          <div><small>{record.status === "won" ? "Won reason" : "Lost reason"}</small><strong>{outcomeReason?.name || "Reason not recorded"}</strong></div>
          <p>{String(record.outcomeNotes || record.lossNotes || "No outcome notes recorded.")}</p>
        </section>
      ) : null}

      <OpportunityWorkspaceTabs
        opportunityId={id}
        partyId={record.partyId ? String(record.partyId) : null}
        currentUserId={session.userId}
        canManage={canManage}
        canManageRisks={canManageRisks}
        canManageStakeholders={canManageStakeholders}
        opportunityStatus={String(record.status)}
        currencyCode={String(record.currencyCode || "INR")}
        items={JSON.parse(JSON.stringify(data.items))}
        team={JSON.parse(JSON.stringify(data.team))}
        competitors={JSON.parse(JSON.stringify(data.competitors))}
        risks={JSON.parse(JSON.stringify(data.risks))}
        committees={JSON.parse(JSON.stringify(data.committees))}
        committeeMembers={JSON.parse(JSON.stringify(data.committeeMembers))}
        actionPlan={data.actionPlan ? JSON.parse(JSON.stringify(data.actionPlan)) : null}
        actionPlanEvaluation={data.actionPlanEvaluation ? JSON.parse(JSON.stringify(data.actionPlanEvaluation)) : null}
        winLossReview={data.winLossReview ? JSON.parse(JSON.stringify(data.winLossReview)) : null}
        quotations={JSON.parse(JSON.stringify(data.quotations))}
        users={(data.options.users || []).map((u) => ({ id: String(u.id), fullName: String(u.fullName || u.email || "User") }))}
        allCompetitors={data.allCompetitors.map((c) => ({ id: String(c.id), name: String(c.name) }))}
        history={JSON.parse(JSON.stringify(data.history))}
        probabilityHistory={JSON.parse(JSON.stringify(data.probabilityHistory))}
      />
    </Record360Archetype>
  );
}
