import {
  getCrmOpportunityRevenueReadiness,
  getOpportunityRevenueDashboard,
} from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import CrmActionWorkbench, {
  type CrmActionDefinition,
} from "@/components/crm/crm-action-workbench";
import CrmWorkspaceShell from "@/components/crm/crm-workspace-shell";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const actions: CrmActionDefinition[] = [
  {
    id: "recurring-revenue",
    label: "Save recurring revenue",
    description:
      "Create a contract-period revenue schedule for an opportunity.",
    endpoint: "/api/crm/opportunity-revenue",
    fixedBody: { action: "save-recurring-revenue" },
    fields: [
      { name: "opportunityId", label: "Opportunity ID", required: true },
      {
        name: "currencyCode",
        label: "Currency",
        defaultValue: "INR",
        required: true,
      },
      { name: "startDate", label: "Start date", type: "date", required: true },
      { name: "endDate", label: "End date", type: "date", required: true },
      {
        name: "billingFrequency",
        label: "Billing frequency",
        type: "select",
        required: true,
        defaultValue: "monthly",
        options: [
          { label: "Monthly", value: "monthly" },
          { label: "Quarterly", value: "quarterly" },
          { label: "Yearly", value: "yearly" },
          { label: "One time", value: "one_time" },
        ],
      },
      {
        name: "amount",
        label: "Contract amount",
        type: "number",
        required: true,
      },
    ],
  },
  {
    id: "revenue-splits",
    label: "Allocate revenue splits",
    description:
      "Balance seller, team and partner revenue credit to exactly 100%.",
    endpoint: "/api/crm/opportunity-revenue",
    fixedBody: { action: "save-revenue-splits" },
    fields: [
      { name: "opportunityId", label: "Opportunity ID", required: true },
      {
        name: "splits",
        label: "Splits",
        type: "json",
        required: true,
        defaultValue: [
          {
            participantType: "user",
            participantId: "USER_UUID",
            percentage: 100,
          },
        ],
      },
    ],
  },
  {
    id: "action-plan",
    label: "Save mutual action plan",
    description: "Create a customer-visible close plan and milestones.",
    endpoint: "/api/crm/opportunity-revenue",
    fixedBody: { action: "save-action-plan" },
    fields: [
      { name: "opportunityId", label: "Opportunity ID", required: true },
      { name: "name", label: "Plan name", required: true },
      { name: "targetCloseDate", label: "Target close date", type: "date" },
      {
        name: "milestones",
        label: "Milestones",
        type: "json",
        required: true,
        defaultValue: [
          {
            title: "Confirm solution scope",
            dueDate: new Date().toISOString().slice(0, 10),
            ownerType: "seller",
          },
        ],
      },
    ],
  },
  {
    id: "clone-opportunity",
    label: "Clone opportunity",
    description: "Create a governed copy without copying lifecycle history.",
    endpoint: "/api/crm/opportunity-revenue",
    fixedBody: { action: "clone-opportunity" },
    fields: [
      { name: "opportunityId", label: "Source opportunity ID", required: true },
      { name: "name", label: "New opportunity name" },
      { name: "expectedCloseDate", label: "Expected close", type: "date" },
      {
        name: "copyProducts",
        label: "Copy product lines",
        type: "checkbox",
        defaultValue: true,
      },
      { name: "copyActionPlan", label: "Copy action plan", type: "checkbox" },
    ],
  },
  {
    id: "win-loss",
    label: "Submit win/loss review",
    description: "Capture structured outcome, competitor and reason evidence.",
    endpoint: "/api/crm/opportunity-revenue",
    fixedBody: { action: "submit-win-loss" },
    fields: [
      { name: "opportunityId", label: "Opportunity ID", required: true },
      {
        name: "outcome",
        label: "Outcome",
        type: "select",
        required: true,
        defaultValue: "won",
        options: [
          { label: "Won", value: "won" },
          { label: "Lost", value: "lost" },
          { label: "No decision", value: "no_decision" },
        ],
      },
      { name: "primaryReason", label: "Primary reason", required: true },
      { name: "competitorName", label: "Competitor" },
      { name: "notes", label: "Review notes", type: "textarea" },
    ],
  },
  {
    id: "predictive-forecast",
    label: "Capture predictive forecast",
    description: "Store an explainable forecast snapshot and risk factors.",
    endpoint: "/api/crm/opportunity-revenue",
    fixedBody: { action: "capture-predictive-forecast" },
    fields: [
      { name: "opportunityId", label: "Opportunity ID" },
      {
        name: "predictedProbability",
        label: "Probability (%)",
        type: "number",
        required: true,
      },
      { name: "predictedCloseDate", label: "Predicted close", type: "date" },
      { name: "predictedAmount", label: "Predicted amount", type: "number" },
      {
        name: "riskFactors",
        label: "Risk factors",
        type: "json",
        defaultValue: ["No activity in fourteen days"],
      },
      {
        name: "explanation",
        label: "Explanation",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "quota-seasonality",
    label: "Allocate quota seasonality",
    description: "Allocate a quota plan across periods with exact totals.",
    endpoint: "/api/crm/opportunity-revenue",
    fixedBody: { action: "save-quota-seasonality" },
    fields: [
      { name: "quotaPlanId", label: "Quota plan ID", required: true },
      {
        name: "allocations",
        label: "Period allocations",
        type: "json",
        required: true,
        defaultValue: [
          { period: "2026-Q1", percentage: 25 },
          { period: "2026-Q2", percentage: 25 },
          { period: "2026-Q3", percentage: 25 },
          { period: "2026-Q4", percentage: 25 },
        ],
      },
    ],
  },
];

export default async function OpportunityRevenuePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return (
      <AccessDenied area="opportunity revenue intelligence" returnHref="/crm" />
    );
  }
  const context = crmContext(session);
  const { dashboard, readiness } = (await tenantTransaction(
    context.organizationId,
    async (client) => ({
      dashboard: await getOpportunityRevenueDashboard(client, context),
      readiness: await getCrmOpportunityRevenueReadiness(client, context),
    }),
  )) as { dashboard: Row; readiness: Row };
  const summary = (dashboard.summary || {}) as Row;
  const quota = (dashboard.quota || {}) as Row;
  const forecast = (dashboard.latestForecast || null) as Row | null;
  const actionPlans = (dashboard.actionPlans || []) as Row[];

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/pipeline", label: "Pipeline" },
        { href: "/crm/opportunities", label: "Opportunities" },
        { href: "/crm/reports", label: "Reports" },
      ]}
      description="Manage recurring revenue, team credit, mutual action plans, win/loss evidence, predictive forecasts and seasonal quota allocations."
      eyebrow="Opportunity revenue intelligence"
      metrics={[
        {
          label: "Open opportunities",
          value: String(summary.open_opportunities ?? 0),
        },
        { label: "Open pipeline", value: money(summary.open_pipeline) },
        {
          label: "Overdue deals",
          value: String(summary.overdue ?? 0),
          tone: Number(summary.overdue || 0) ? "warning" : "success",
        },
        { label: "Quota target", value: money(quota.target) },
      ]}
      status={`${String(readiness.readiness || "blocked")} · ${String(readiness.passed || 0)}/${String(readiness.total || 0)}`}
      statusTone={readiness.readiness === "ready" ? "success" : "warning"}
      title="Commercial plans, splits and forecast evidence"
    >
      <CrmActionWorkbench actions={actions} />
      <div className="crm-product-data-grid">
        <section className="panel">
          <p className="eyebrow">Latest predictive forecast</p>
          <h2>{forecast ? money(forecast.predicted_amount) : "No snapshot"}</h2>
          <p>
            {forecast
              ? `${String(forecast.predicted_probability ?? 0)}% probability · ${String(forecast.predicted_close_date || "No close date")}`
              : "Capture a forecast snapshot to establish explainable evidence."}
          </p>
        </section>
        <section className="panel">
          <p className="eyebrow">Mutual action plans</p>
          <h2>{String(actionPlans.length)}</h2>
          <div className="crm-stage-summary">
            {actionPlans.slice(0, 5).map((plan) => (
              <div key={String(plan.id)}>
                <span>
                  <strong>{String(plan.name)}</strong>
                  <small>
                    {String(plan.completed ?? 0)}/{String(plan.milestones ?? 0)}{" "}
                    milestones
                  </small>
                </span>
                <b>{String(plan.status)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
    </CrmWorkspaceShell>
  );
}
