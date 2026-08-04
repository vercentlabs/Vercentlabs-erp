import {
  getCrmCustomerSuccessReadiness,
  getCustomerSuccessDashboard,
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

const actions: CrmActionDefinition[] = [
  {
    id: "create-plan",
    label: "Create success plan",
    description: "Start a governed onboarding or adoption plan for an account.",
    endpoint: "/api/crm/customer-success/accounts/{accountId}",
    fixedBody: { action: "create_plan" },
    fields: [
      { name: "accountId", label: "Account ID", path: true, required: true },
      { name: "name", label: "Plan name", required: true },
      {
        name: "objective",
        label: "Objective",
        type: "textarea",
        required: true,
      },
      { name: "startDate", label: "Start date", type: "date" },
      { name: "targetDate", label: "Target date", type: "date" },
      { name: "ownerUserId", label: "Owner user ID" },
      {
        name: "milestones",
        label: "Initial milestones",
        type: "json",
        defaultValue: [
          { title: "Kick-off", sequence: 1 },
          { title: "First value", sequence: 2, dependsOnSequence: 1 },
        ],
      },
    ],
  },
  {
    id: "milestone",
    label: "Update milestone",
    description: "Complete, block or reopen a success milestone.",
    endpoint: "/api/crm/customer-success/accounts/{accountId}",
    fixedBody: { action: "update_milestone" },
    fields: [
      { name: "accountId", label: "Account ID", path: true, required: true },
      { name: "milestoneId", label: "Milestone ID", required: true },
      {
        name: "status",
        label: "Status",
        type: "select",
        required: true,
        defaultValue: "completed",
        options: [
          { label: "Planned", value: "planned" },
          { label: "In progress", value: "in_progress" },
          { label: "Blocked", value: "blocked" },
          { label: "Completed", value: "completed" },
        ],
      },
      { name: "completionNotes", label: "Notes", type: "textarea" },
    ],
  },
  {
    id: "renewal",
    label: "Upsert renewal",
    description: "Create or update a renewal forecast and risk profile.",
    endpoint: "/api/crm/customer-success/accounts/{accountId}",
    fixedBody: { action: "upsert_renewal" },
    fields: [
      { name: "accountId", label: "Account ID", path: true, required: true },
      {
        name: "renewalDate",
        label: "Renewal date",
        type: "date",
        required: true,
      },
      { name: "recurringValue", label: "Recurring value", type: "number" },
      {
        name: "forecastCategory",
        label: "Forecast category",
        type: "select",
        defaultValue: "pipeline",
        options: [
          { label: "Pipeline", value: "pipeline" },
          { label: "Best case", value: "best_case" },
          { label: "Commit", value: "commit" },
          { label: "Renewed", value: "renewed" },
        ],
      },
      {
        name: "riskLevel",
        label: "Risk level",
        type: "select",
        defaultValue: "medium",
        options: [
          { label: "Low", value: "low" },
          { label: "Medium", value: "medium" },
          { label: "High", value: "high" },
          { label: "Critical", value: "critical" },
        ],
      },
      { name: "notes", label: "Renewal notes", type: "textarea" },
    ],
  },
  {
    id: "intervention",
    label: "Create churn intervention",
    description: "Open an owned recovery action for an at-risk customer.",
    endpoint: "/api/crm/customer-success/accounts/{accountId}",
    fixedBody: { action: "create_intervention" },
    fields: [
      { name: "accountId", label: "Account ID", path: true, required: true },
      { name: "title", label: "Intervention title", required: true },
      {
        name: "severity",
        label: "Severity",
        type: "select",
        defaultValue: "high",
        options: [
          { label: "Low", value: "low" },
          { label: "Medium", value: "medium" },
          { label: "High", value: "high" },
          { label: "Critical", value: "critical" },
        ],
      },
      { name: "reason", label: "Reason", type: "textarea", required: true },
      { name: "ownerUserId", label: "Owner user ID" },
      { name: "dueDate", label: "Due date", type: "date" },
    ],
  },
  {
    id: "recalculate-health",
    label: "Recalculate health",
    description: "Refresh adoption, feedback, service and renewal health.",
    endpoint: "/api/crm/customer-success/accounts/{accountId}",
    fixedBody: { action: "recalculate_health" },
    fields: [
      { name: "accountId", label: "Account ID", path: true, required: true },
    ],
  },
  {
    id: "usage",
    label: "Ingest product usage",
    description: "Record an idempotent product-adoption event.",
    endpoint: "/api/crm/customer-success/usage",
    fields: [
      { name: "partyId", label: "Account ID", required: true },
      { name: "eventType", label: "Event type", required: true },
      { name: "eventKey", label: "Idempotency event key", required: true },
      { name: "occurredAt", label: "Occurred at", type: "datetime-local" },
      { name: "value", label: "Value", type: "number" },
      { name: "metadata", label: "Metadata", type: "json", defaultValue: {} },
    ],
  },
  {
    id: "feedback",
    label: "Record customer feedback",
    description: "Capture NPS, CSAT or CES and trigger follow-up rules.",
    endpoint: "/api/crm/customer-success/feedback",
    fields: [
      { name: "partyId", label: "Account ID", required: true },
      {
        name: "feedbackType",
        label: "Feedback type",
        type: "select",
        required: true,
        defaultValue: "nps",
        options: [
          { label: "NPS", value: "nps" },
          { label: "CSAT", value: "csat" },
          { label: "CES", value: "ces" },
        ],
      },
      { name: "score", label: "Score", type: "number", required: true },
      { name: "comment", label: "Comment", type: "textarea" },
      { name: "respondentEmail", label: "Respondent email", type: "email" },
    ],
  },
];

export default async function CustomerSuccessPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return <AccessDenied area="customer success" returnHref="/crm" />;
  }
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getCustomerSuccessDashboard(client, context),
        getCrmCustomerSuccessReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const renewals = (dashboard.renewals || []) as Row[];
  const interventions = (dashboard.interventions || []) as Row[];
  const milestones = (dashboard.upcomingMilestones || []) as Row[];

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/accounts", label: "Accounts" },
        { href: "/crm/reports", label: "Reports" },
      ]}
      description="Operate onboarding, adoption telemetry, feedback, health, renewals and churn recovery from one account-centred workspace."
      eyebrow="Customer success"
      metrics={[
        { label: "Active plans", value: String(summary.active_plans ?? 0) },
        {
          label: "Healthy",
          value: String(summary.healthy ?? 0),
          tone: "success",
        },
        {
          label: "At risk",
          value: String(
            Number(summary.at_risk ?? 0) + Number(summary.critical ?? 0),
          ),
          tone:
            Number(summary.at_risk ?? 0) + Number(summary.critical ?? 0)
              ? "warning"
              : "success",
        },
        {
          label: "Average health",
          value: String(summary.average_health ?? "—"),
        },
      ]}
      status={`${String(readiness.readiness || "blocked")} · ${String(readiness.score || 0)}%`}
      statusTone={readiness.readiness === "ready" ? "success" : "warning"}
      title="Adoption, health and renewals"
    >
      <CrmActionWorkbench actions={actions} />
      <div className="crm-product-data-grid">
        <section className="panel">
          <h2>Renewal pipeline</h2>
          <div className="crm-stage-summary">
            {renewals.length ? (
              renewals.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.display_name)}</strong>
                    <small>
                      {String(row.renewal_date)} ·{" "}
                      {String(row.forecast_category)}
                    </small>
                  </span>
                  <b>{String(row.risk_level)}</b>
                </div>
              ))
            ) : (
              <p>No open renewals.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Churn interventions</h2>
          <div className="crm-stage-summary">
            {interventions.length ? (
              interventions.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.display_name)}</strong>
                    <small>{String(row.title)}</small>
                  </span>
                  <b>{String(row.severity)}</b>
                </div>
              ))
            ) : (
              <p>No open interventions.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Milestones due</h2>
          <div className="crm-stage-summary">
            {milestones.length ? (
              milestones.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.display_name)}</strong>
                    <small>{String(row.title)}</small>
                  </span>
                  <b>{String(row.due_date)}</b>
                </div>
              ))
            ) : (
              <p>No milestone is due in the next fourteen days.</p>
            )}
          </div>
        </section>
      </div>
    </CrmWorkspaceShell>
  );
}
